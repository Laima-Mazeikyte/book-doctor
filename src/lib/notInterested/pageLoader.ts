import { get, writable } from 'svelte/store';
import { authStore, waitForAuthReady } from '$lib/stores/auth';
import { notInterestedStore } from '$lib/stores/notInterested';
import type {
	NotInterestedLoaderSnapshot,
	NotInterestedOrder,
	NotInterestedPage,
	NotInterestedPageState
} from './types';
import type { Book } from '$lib/types/book';

interface InternalEntry extends NotInterestedPageState {
	stale: boolean;
	generation: number;
	inFlight: Map<string, Promise<void>>;
	/** IDs removed by a local mutation/hydration while a page request may still be in flight. */
	removedBookIds: Set<string>;
}

const FIRST_PAGE_KEY = '__first__';
const ORDERS: NotInterestedOrder[] = ['newest', 'oldest'];

function createEntry(): InternalEntry {
	return {
		books: [],
		nextCursor: null,
		loaded: false,
		loading: false,
		error: null,
		stale: false,
		generation: 0,
		inFlight: new Map(),
		removedBookIds: new Set()
	};
}

function createEntries(): Record<NotInterestedOrder, InternalEntry> {
	return {
		newest: createEntry(),
		oldest: createEntry()
	};
}

function publicEntry(entry: InternalEntry): NotInterestedPageState {
	return {
		books: [...entry.books],
		nextCursor: entry.nextCursor,
		loaded: entry.loaded,
		loading: entry.loading,
		error: entry.error
	};
}

let activeAccountId = get(authStore).user?.id ?? null;
let entries = createEntries();

const snapshotStore = writable<NotInterestedLoaderSnapshot>({
	accountId: activeAccountId,
	entries: {
		newest: publicEntry(entries.newest),
		oldest: publicEntry(entries.oldest)
	}
});

function publish(): void {
	snapshotStore.set({
		accountId: activeAccountId,
		entries: {
			newest: publicEntry(entries.newest),
			oldest: publicEntry(entries.oldest)
		}
	});
}

function resetForAccount(accountId: string | null): void {
	if (activeAccountId === accountId) return;
	for (const order of ORDERS) entries[order].inFlight.clear();
	activeAccountId = accountId;
	entries = createEntries();
	publish();
}

function accountIdFromAuth(): string | null {
	return get(authStore).user?.id ?? null;
}

function syncAccount(): string | null {
	const accountId = accountIdFromAuth();
	resetForAccount(accountId);
	return accountId;
}

function clearRemovalMarker(bookId: string): void {
	if (!bookId) return;
	for (const order of ORDERS) entries[order].removedBookIds.delete(bookId);
}

/** Fetch one server page. The caller supplies the token read immediately before the request. */
export async function fetchNotInterestedPage(
	order: NotInterestedOrder,
	cursor: string | null,
	accessToken: string
): Promise<NotInterestedPage> {
	const params = new URLSearchParams({ order });
	if (cursor) params.set('cursor', cursor);

	const response = await fetch(`/api/not-interested/books?${params.toString()}`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (!response.ok) throw new Error('Failed to load not interested');

	const data = (await response.json()) as { books?: unknown; nextCursor?: unknown };
	if (!Array.isArray(data.books)) throw new Error('Failed to load not interested');
	if (
		data.nextCursor !== null &&
		typeof data.nextCursor !== 'string' &&
		data.nextCursor !== undefined
	) {
		throw new Error('Failed to load not interested');
	}

	return {
		books: data.books as Book[],
		nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null
	};
}

async function requestAuthContext(): Promise<{ accountId: string; accessToken: string } | null> {
	await waitForAuthReady();
	await notInterestedStore.flushPending().catch(() => undefined);

	// Read the session after auth restoration and mutation persistence have settled, immediately
	// before selecting a page. This avoids sending an old account's token after a session switch.
	const auth = get(authStore);
	const accountId = auth.user?.id ?? null;
	const accessToken = auth.session?.access_token ?? null;
	resetForAccount(accountId);
	if (!accountId || !accessToken) return null;
	return { accountId, accessToken };
}

function cancelEntry(entry: InternalEntry): void {
	entry.generation += 1;
	entry.inFlight.clear();
	entry.loading = false;
	entry.error = null;
}

function isCurrent(
	order: NotInterestedOrder,
	entry: InternalEntry,
	accountId: string,
	generation: number
): boolean {
	return (
		activeAccountId === accountId && entries[order] === entry && entry.generation === generation
	);
}

function appendUnique(existing: Book[], incoming: Book[]): Book[] {
	const seen = new Set(existing.map((book) => book.id));
	const result = [...existing];
	for (const book of incoming) {
		if (seen.has(book.id)) continue;
		seen.add(book.id);
		result.push(book);
	}
	return result;
}

function requestPage(
	order: NotInterestedOrder,
	entry: InternalEntry,
	cursor: string | null,
	accountId: string,
	accessToken: string,
	replaceExistingBooks: boolean
): Promise<void> {
	const pageKey = cursor ?? FIRST_PAGE_KEY;
	const existingRequest = entry.inFlight.get(pageKey);
	if (existingRequest) return existingRequest;

	const generation = entry.generation;
	entry.loading = true;
	entry.error = null;
	publish();

	const request = fetchNotInterestedPage(order, cursor, accessToken)
		.then((page) => {
			if (!isCurrent(order, entry, accountId, generation)) return;
			const visibleBooks = page.books.filter((book) => !entry.removedBookIds.has(book.book_id));
			entry.books = replaceExistingBooks ? visibleBooks : appendUnique(entry.books, visibleBooks);
			entry.nextCursor = page.nextCursor;
			entry.loaded = true;
			entry.stale = false;
		})
		.catch((reason: unknown) => {
			if (!isCurrent(order, entry, accountId, generation)) return;
			entry.error = reason instanceof Error ? reason.message : 'Failed to load not interested';
		})
		.finally(() => {
			if (!isCurrent(order, entry, accountId, generation)) return;
			entry.loading = false;
			entry.inFlight.delete(pageKey);
			publish();
		});

	entry.inFlight.set(pageKey, request);
	return request;
}

async function startFirstPage(order: NotInterestedOrder): Promise<void> {
	const auth = await requestAuthContext();
	const entry = entries[order];
	if (!auth) {
		entry.loading = false;
		entry.loaded = true;
		entry.error = null;
		publish();
		return;
	}
	if (activeAccountId !== auth.accountId) return;

	const generation = entry.generation;
	await requestPage(order, entry, null, auth.accountId, auth.accessToken, true);
	if (entries[order] !== entry || activeAccountId !== auth.accountId) return;

	// A real mutation may invalidate the first request while the surface is still waiting for it.
	// Keep that active ensureLoaded call alive by restarting the replacement request. Hydration
	// events are deliberately not invalidating this generation, so they settle normally above.
	if (entry.generation !== generation && entry.stale && !entry.loading && !entry.error) {
		return startFirstPage(order);
	}
}

async function startNextPage(order: NotInterestedOrder): Promise<void> {
	const auth = await requestAuthContext();
	if (!auth || activeAccountId !== auth.accountId) return;
	const entry = entries[order];
	if (!entry.loaded || entry.stale || !entry.nextCursor) return;
	return requestPage(order, entry, entry.nextCursor, auth.accountId, auth.accessToken, false);
}

const loader = {
	subscribe: snapshotStore.subscribe,
	getSnapshot(order: NotInterestedOrder): NotInterestedPageState {
		return publicEntry(entries[order]);
	},
	async ensureLoaded(order: NotInterestedOrder): Promise<void> {
		await waitForAuthReady();
		syncAccount();
		const entry = entries[order];
		if (entry.loaded && !entry.stale) return;
		if (entry.stale) {
			if (entry.loading) return startFirstPage(order);
			// Keep the last successful page visible while the replacement first page is loading.
			// The response replaces this cache only after it succeeds.
			cancelEntry(entry);
		}
		return startFirstPage(order);
	},
	async loadMore(order: NotInterestedOrder): Promise<void> {
		await waitForAuthReady();
		syncAccount();
		const entry = entries[order];
		if (entry.stale || !entry.loaded) return this.ensureLoaded(order);
		if (!entry.nextCursor) return;
		return startNextPage(order);
	},
	async retry(order: NotInterestedOrder): Promise<void> {
		await waitForAuthReady();
		syncAccount();
		const entry = entries[order];
		if (entry.stale || !entry.loaded) return this.ensureLoaded(order);
		if (!entry.error) return;
		if (entry.nextCursor) return startNextPage(order);
		return startFirstPage(order);
	},
	/** Mark a successful cache stale; the next tab activation reloads its first page. */
	invalidate(order?: NotInterestedOrder): void {
		const orders = order ? [order] : ORDERS;
		let changed = false;
		for (const currentOrder of orders) {
			const entry = entries[currentOrder];
			if (!entry.loaded && !entry.loading) continue;
			entry.stale = true;
			entry.generation += 1;
			entry.inFlight.clear();
			entry.loading = false;
			entry.error = null;
			entry.removedBookIds.clear();
			changed = true;
		}
		if (changed) publish();
	},
	/** Remove a restored/bookmarked/rated book without changing the server cursor. */
	removeBook(bookId: string): void {
		if (!bookId) return;
		let changed = false;
		for (const order of ORDERS) {
			const entry = entries[order];
			// Keep this independent of the loaded rows. A next-page response can still contain
			// this book even when it was not present in the cache when the mutation happened.
			entry.removedBookIds.add(bookId);
			const nextBooks = entry.books.filter((book) => book.book_id !== bookId);
			if (nextBooks.length === entry.books.length) continue;
			entry.books = nextBooks;
			changed = true;
		}
		if (changed) publish();
	},
	reset(): void {
		for (const order of ORDERS) entries[order].inFlight.clear();
		entries = createEntries();
		publish();
	}
};

authStore.subscribe(({ user }) => {
	resetForAccount(user?.id ?? null);
});

notInterestedStore.onChange(({ action, bookId, source }) => {
	if (action === 'remove') {
		loader.removeBook(bookId);
		return;
	}
	clearRemovalMarker(bookId);

	// The library bootstrap can hydrate the dismissed-ID store after this loader has already
	// started its first request. That hydration is a state snapshot, not a new mutation; keep the
	// initial request valid so its response can settle the surface instead of leaving it unloaded.
	if (source === 'hydrate') {
		for (const order of ORDERS) {
			const entry = entries[order];
			if (!entry.loaded && entry.loading) continue;
			loader.invalidate(order);
		}
		return;
	}
	loader.invalidate();
});

export const notInterestedPageStore = snapshotStore;
export const notInterestedPageLoader = loader;
