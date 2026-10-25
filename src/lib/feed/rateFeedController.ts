import { writable } from 'svelte/store';
import {
	feedStateMeetsInteractionThreshold,
	shouldRequestInitialPersonalizedFeed,
	shouldShowLatestRateFeed,
	type LatestRateFeedMode
} from '$lib/rate/feedEligibility';
import type { Book } from '$lib/types/book';
import { FEED_READ_TIMEOUT_MS } from './constants';
import {
	RATE_FEED_CACHE_MAX_BOOKS,
	type CachedRateFeed,
	type CachedRateFeedSource,
	type RateFeedCache
} from './rateFeedCache';

export type LatestFeedStateResponse = {
	mode: LatestRateFeedMode;
	books: Book[];
	request_id: string | null;
	latest_request_id: string | null;
	latest_request_status: string | null;
	latest_request_error_message: string | null;
	ratings_count: number;
	interaction_count?: number;
	eligible_for_feed?: boolean;
	status: string;
	error_message: string | null;
};

export type RateFeedIdentity = { userId: string; accessToken: string };
export type RateFeedEntry = { readonly id: number; readonly ownerId: string | null };
export type RateFeedSource = { kind: 'curated' | 'popular'; requestId: string | null };
export type PreparedRateFeed = {
	ownerId: string;
	fetchedAt: number;
	payload: LatestFeedStateResponse;
};
export type InitialRateFeedChoice =
	| { kind: 'curated'; books: Book[]; requestId: string | null }
	| { kind: 'popular'; preservePersonalizedFeedMode: boolean };
export type GeneratedRateFeed = { books: Book[]; requestId: string };

export class RateFeedReadError extends Error {
	constructor(public readonly status: number) {
		super(`Failed to load latest feed state: HTTP ${status}`);
	}
}

export class RateFeedReadTimeoutError extends Error {
	constructor() {
		super('Feed read timed out');
		this.name = 'RateFeedReadTimeoutError';
	}
}

export type RateFeedState = {
	ownerId: string | null;
	activeBooks: Book[];
	activeSource: RateFeedSource | null;
	preparedSnapshot: PreparedRateFeed | null;
	loadingInitial: boolean;
	refreshing: boolean;
	refreshError: string | null;
};

type Options = {
	readLatest: (identity: RateFeedIdentity, signal: AbortSignal) => Promise<LatestFeedStateResponse>;
	now?: () => number;
	freshMs?: number;
	cache?: RateFeedCache;
	persistDelayMs?: number;
	readTimeoutMs?: number;
};

/** Each layout owns one instance. Preparation never changes an admitted list or creates jobs. */
export function createRateFeedController({
	readLatest,
	now = Date.now,
	freshMs = 5 * 60_000,
	cache,
	persistDelayMs = 200,
	readTimeoutMs = FEED_READ_TIMEOUT_MS
}: Options) {
	const empty = (ownerId: string | null): RateFeedState => ({
		ownerId,
		activeBooks: [],
		activeSource: null,
		preparedSnapshot: null,
		loadingInitial: false,
		refreshing: false,
		refreshError: null
	});
	let state = empty(null);
	const store = writable(state);
	let ownerGeneration = 0;
	let snapshotRevision = 0;
	let entryId = 0;
	let entry: RateFeedEntry | null = null;
	let initial: { entry: RateFeedEntry; promise: Promise<InitialRateFeedChoice | null> } | null =
		null;
	let pending: {
		abort: AbortController;
		promise: Promise<LatestFeedStateResponse | null>;
	} | null = null;
	let destroyed = false;
	let cacheTimer: ReturnType<typeof setTimeout> | undefined;
	let queuedSnapshot: CachedRateFeed | null = null;

	function flushSnapshot() {
		clearTimeout(cacheTimer);
		cacheTimer = undefined;
		if (queuedSnapshot) cache?.write(queuedSnapshot);
		queuedSnapshot = null;
	}
	function queueSnapshot(snapshot: CachedRateFeed) {
		if (!cache || destroyed) return;
		queuedSnapshot = snapshot;
		if (!cacheTimer) cacheTimer = setTimeout(flushSnapshot, persistDelayMs);
	}
	function clearPersisted(ownerId: string) {
		if (queuedSnapshot?.ownerId === ownerId) {
			clearTimeout(cacheTimer);
			cacheTimer = undefined;
			queuedSnapshot = null;
		}
		cache?.clear(ownerId);
	}

	function publish(patch: Partial<RateFeedState>) {
		state = { ...state, ...patch };
		store.set(state);
	}

	function isCurrentEntry(candidate: RateFeedEntry | null): candidate is RateFeedEntry {
		return (
			!destroyed && candidate != null && candidate === entry && candidate.ownerId === state.ownerId
		);
	}

	function setOwner(ownerId: string | null, { retainPublicBooks = false } = {}) {
		if (destroyed || state.ownerId === ownerId) return;
		flushSnapshot();
		const publicBooks =
			retainPublicBooks && state.ownerId === null && state.activeSource?.kind === 'popular'
				? state.activeBooks
				: null;
		ownerGeneration++;
		pending?.abort.abort();
		pending = null;
		entry = null;
		initial = null;
		state = empty(ownerId);
		if (publicBooks) {
			state.activeBooks = publicBooks;
			state.activeSource = { kind: 'popular', requestId: null };
		}
		store.set(state);
	}

	function prepare(
		identity: RateFeedIdentity,
		{ force = false }: { force?: boolean } = {}
	): Promise<LatestFeedStateResponse | null> {
		if (destroyed || state.ownerId !== identity.userId) return Promise.resolve(null);
		if (pending) return pending.promise;
		const snapshot = state.preparedSnapshot;
		if (!force && snapshot && now() - snapshot.fetchedAt < freshMs) {
			return Promise.resolve(snapshot.payload);
		}

		const generation = ownerGeneration;
		const revision = snapshotRevision;
		const abort = new AbortController();
		const current = () => !destroyed && generation === ownerGeneration;
		let timeout: ReturnType<typeof setTimeout>;
		let onAbort: () => void;
		// Settle independently of transport cooperation. The read includes JSON parsing;
		// a late transport result cannot publish after this promise has timed out.
		const read = new Promise<LatestFeedStateResponse | null>((resolve, reject) => {
			onAbort = () => reject(abort.signal.reason);
			abort.signal.addEventListener('abort', onAbort, { once: true });
			timeout = setTimeout(() => abort.abort(new RateFeedReadTimeoutError()), readTimeoutMs);
			Promise.resolve()
				.then(() =>
					current() && !abort.signal.aborted ? readLatest(identity, abort.signal) : null
				)
				.then(resolve, reject);
		});
		const promise = read
			.then((payload) => {
				if (!current() || payload == null) return null;
				if (revision === snapshotRevision) {
					const fetchedAt = now();
					publish({
						preparedSnapshot: { ownerId: identity.userId, fetchedAt, payload }
					});
					if (shouldShowLatestRateFeed(payload)) {
						queueSnapshot({
							version: 1,
							ownerId: identity.userId,
							fetchedAt,
							source: { kind: 'curated', requestId: payload.request_id },
							books: payload.books.slice(0, RATE_FEED_CACHE_MAX_BOOKS)
						});
					} else if (
						payload.mode !== 'below_threshold' ||
						cache?.read(identity.userId)?.source.kind !== 'popular'
					) {
						// An authoritative empty read retires reusable disk candidates, not mounted cards.
						clearPersisted(identity.userId);
					}
				}
				return payload;
			})
			.catch((error: unknown) => {
				if (!current()) return null;
				if (error instanceof RateFeedReadError && (error.status === 401 || error.status === 403)) {
					// A rejected session must revalidate before a later entry can reuse this data.
					publish({ preparedSnapshot: null });
					clearPersisted(identity.userId);
				}
				publish({ refreshError: error instanceof Error ? error.message : 'Failed to load feed' });
				throw error;
			})
			.finally(() => {
				clearTimeout(timeout);
				abort.signal.removeEventListener('abort', onAbort);
				if (current() && pending?.abort === abort) {
					pending = null;
					publish({ refreshing: false });
				}
			});
		pending = { abort, promise };
		publish({ refreshing: true, refreshError: null });
		return promise;
	}

	function enter(): RateFeedEntry {
		entry = { id: ++entryId, ownerId: state.ownerId };
		initial = null;
		publish({ activeBooks: [], activeSource: null, loadingInitial: true });
		return entry;
	}

	function leave(candidate: RateFeedEntry | null) {
		if (!isCurrentEntry(candidate)) return;
		entry = null;
		initial = null;
		publish({ activeBooks: [], activeSource: null, loadingInitial: false });
		flushSnapshot();
		// An account-owned read can finish into preparedSnapshot after navigation.
	}

	function resolveInitial(
		candidate: RateFeedEntry,
		identity: RateFeedIdentity | null,
		generate: (payload: LatestFeedStateResponse) => Promise<GeneratedRateFeed | null>,
		filterBooks: (books: Book[]) => Book[] = (books) => books
	): Promise<InitialRateFeedChoice | null> {
		if (!isCurrentEntry(candidate)) return Promise.resolve(null);
		if (initial?.entry === candidate) return initial.promise;
		const promise = (async (): Promise<InitialRateFeedChoice | null> => {
			const popular = (preservePersonalizedFeedMode = false): InitialRateFeedChoice => ({
				kind: 'popular',
				preservePersonalizedFeedMode
			});
			if (!identity) return popular();
			try {
				const reused = state.preparedSnapshot && now() - state.preparedSnapshot.fetchedAt < freshMs;
				let payload = await prepare(identity);
				if (
					reused &&
					payload &&
					shouldShowLatestRateFeed(payload) &&
					!filterBooks(payload.books).length
				) {
					payload = await prepare(identity, { force: true });
				}
				if (!isCurrentEntry(candidate) || !payload) return null;
				if (!feedStateMeetsInteractionThreshold(payload)) return popular();
				if (shouldShowLatestRateFeed(payload)) {
					if (!filterBooks(payload.books).length) return popular(true);
					return { kind: 'curated', books: payload.books, requestId: payload.request_id };
				}
				if (shouldRequestInitialPersonalizedFeed(payload)) {
					invalidatePrepared();
					const generated = await generate(payload);
					if (!isCurrentEntry(candidate)) return null;
					return generated?.books.length
						? { kind: 'curated', books: generated.books, requestId: generated.requestId }
						: popular(true);
				}
				return popular();
			} catch {
				return isCurrentEntry(candidate) ? popular() : null;
			}
		})();
		initial = { entry: candidate, promise };
		return promise;
	}

	function setActiveBooks(
		candidate: RateFeedEntry | null,
		books: Book[],
		mode: 'replace' | 'append',
		source?: RateFeedSource
	): Book[] {
		if (!isCurrentEntry(candidate)) return [];
		const seen = new Set(mode === 'append' ? state.activeBooks.map((book) => book.book_id) : []);
		const added = books.filter((book) => {
			if (seen.has(book.book_id)) return false;
			seen.add(book.book_id);
			return true;
		});
		publish({
			activeBooks: mode === 'replace' ? added : [...state.activeBooks, ...added],
			activeSource: source ?? state.activeSource
		});
		return added;
	}

	function invalidatePrepared() {
		if (destroyed) return;
		snapshotRevision++;
		publish({ preparedSnapshot: null });
	}

	function restoreInitial(
		candidate: RateFeedEntry,
		filter: (books: Book[]) => Book[]
	): CachedRateFeed | null {
		if (!isCurrentEntry(candidate) || !candidate.ownerId || !cache) return null;
		const prepared = state.preparedSnapshot;
		const recent = prepared && now() - prepared.fetchedAt < freshMs;
		if (recent && prepared.payload.mode !== 'below_threshold') return null;
		const snapshot = cache.read(candidate.ownerId);
		if (!snapshot) return null;
		// Fresh personalized results, including empty ones, win. A confirmed below-threshold
		// account can keep reusing its popular list and pagination hints during memory freshness.
		if (recent && snapshot.source.kind !== 'popular') return null;
		const books = filter(snapshot.books);
		return books.length ? { ...snapshot, books } : null;
	}

	function rememberActive(candidate: RateFeedEntry | null, source: CachedRateFeedSource) {
		if (!isCurrentEntry(candidate) || !candidate.ownerId || !state.activeBooks.length) return;
		const prepared = state.preparedSnapshot;
		const fetchedAt =
			source.kind === 'curated' && prepared?.payload.request_id === source.requestId
				? prepared.fetchedAt
				: now();
		queueSnapshot({
			version: 1,
			ownerId: candidate.ownerId,
			fetchedAt,
			source,
			books: state.activeBooks.slice(-RATE_FEED_CACHE_MAX_BOOKS)
		});
	}

	return {
		subscribe: store.subscribe,
		setOwner,
		prepare,
		enter,
		leave,
		isCurrentEntry,
		resolveInitial,
		setActiveBooks,
		setInitialLoading(candidate: RateFeedEntry | null, loading: boolean) {
			if (!isCurrentEntry(candidate)) return;
			publish({ loadingInitial: loading && state.activeBooks.length === 0 });
		},
		invalidatePrepared,
		restoreInitial,
		rememberActive,
		clearPersisted,
		flushSnapshot,
		destroy() {
			flushSnapshot();
			setOwner(null);
			destroyed = true;
			pending?.abort.abort();
			pending = null;
			entry = null;
			initial = null;
			state = empty(null);
			store.set(state);
		}
	};
}

export type RateFeedController = ReturnType<typeof createRateFeedController>;
