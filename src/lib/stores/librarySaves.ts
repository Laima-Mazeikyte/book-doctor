import { writable } from 'svelte/store';
import type { Book, RatingValue } from '$lib/types/book';

export type LibrarySaveKind = 'rating' | 'bookmark' | 'dismissal';
export type LibrarySaveStatus = 'pending' | 'saving' | 'retrying' | 'failed';
export type LibrarySaveValue = RatingValue | boolean | null;
export interface LibraryChange {
	kind: LibrarySaveKind;
	bookUlid: string;
	bookId?: string;
	book?: Book;
	value: LibrarySaveValue;
}
export interface PendingLibraryChange extends LibraryChange {
	ownerId: string;
	revision: number;
	attempts: number;
	status: LibrarySaveStatus;
	nextAttemptAt: number;
	error?: string;
	errorKind?: 'connection' | 'authentication' | 'rejected';
}
export interface LibrarySaveSnapshot {
	ownerId: string;
	changes: PendingLibraryChange[];
	queuedCount: number;
	pendingCount: number;
	failedCount: number;
	isFlushing: boolean;
}
type Writer = (change: PendingLibraryChange, signal: AbortSignal) => void | Promise<void>;
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

const PREFIX = 'book-doctor:library-pending:v1:';
const GUEST_KEY = `${PREFIX}guest-owner`;
const RETRY_DELAYS = [1000, 2000, 5000];
const KINDS: LibrarySaveKind[] = ['rating', 'bookmark', 'dismissal'];

function browserStorage() {
	try {
		return typeof window === 'undefined' ? null : window.localStorage;
	} catch {
		return null;
	}
}

function validChange(value: unknown, ownerId: string): value is PendingLibraryChange {
	if (!value || typeof value !== 'object') return false;
	const c = value as PendingLibraryChange;
	return (
		c.ownerId === ownerId &&
		KINDS.includes(c.kind) &&
		typeof c.bookUlid === 'string' &&
		c.bookUlid.length > 0 &&
		(c.bookId === undefined || typeof c.bookId === 'string') &&
		Number.isSafeInteger(c.revision) &&
		c.revision > 0 &&
		Number.isInteger(c.attempts) &&
		c.attempts >= 0 &&
		c.attempts <= 4 &&
		['pending', 'saving', 'retrying', 'failed'].includes(c.status) &&
		Number.isFinite(c.nextAttemptAt) &&
		(c.kind === 'rating'
			? c.value === null || [1, 2, 3, 4, 5].includes(c.value as number)
			: typeof c.value === 'boolean')
	);
}

function validStoredBook(book: unknown, change: LibraryChange): book is Book {
	if (!book || typeof book !== 'object') return false;
	const b = book as Book;
	return (
		b.id === change.bookId &&
		b.book_id === change.bookUlid &&
		typeof b.title === 'string' &&
		typeof b.author === 'string' &&
		[b.coverUrl, b.summary, b.year, b.type].every(
			(value) => value === undefined || typeof value === 'string'
		) &&
		(b.genres === undefined ||
			(Array.isArray(b.genres) && b.genres.every((genre) => typeof genre === 'string')))
	);
}

function failureDetails(reason: unknown) {
	const e = reason as { status?: number; code?: string; message?: string } | null;
	const status = e?.status;
	const authentication = status === 401 || e?.code === 'PGRST301';
	const rejected = status != null && status >= 400 && status < 500 && ![408, 429].includes(status);
	return {
		error: typeof e?.message === 'string' ? e.message : 'Could not save this change.',
		errorKind: authentication
			? ('authentication' as const)
			: rejected
				? ('rejected' as const)
				: ('connection' as const),
		retryable: !authentication && !rejected
	};
}

/** One durable intent per field, with a shared serial writer for each account/book. */
export function createLibrarySaveController(
	options: {
		storage?: StorageAccess;
		timeoutMs?: number;
		concurrency?: number;
	} = {}
) {
	const storage = options.storage ?? browserStorage;
	const timeoutMs = options.timeoutMs ?? 15_000;
	const concurrency = options.concurrency ?? 3;
	let ownerId = 'guest:memory';
	let guestOwnerId: string | null = null;
	let revision = 0;
	let initialized = false;
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pumpScheduled = false;
	const queues = new Map<string, Map<string, PendingLibraryChange>>();
	// Keep acknowledgments for reconciliation with reads started before a mutation.
	const recent = new Map<string, Map<string, PendingLibraryChange>>();
	const writers = new Map<LibrarySaveKind, { ownerId: string; write: Writer }>();
	const running = new Map<string, { ownerId: string; controller: AbortController }>();
	const savedListeners = new Set<(bookUlid: string) => void>();
	const waiters = new Set<{
		ownerId: string;
		kind?: LibrarySaveKind;
		resolve: () => void;
		reject: (e: Error) => void;
	}>();
	const state = writable<LibrarySaveSnapshot>({
		ownerId,
		changes: [],
		queuedCount: 0,
		pendingCount: 0,
		failedCount: 0,
		isFlushing: false
	});
	const key = (c: LibraryChange) => `${c.kind}:${c.bookUlid}`;
	const lane = (account: string, bookUlid: string) => `${account}:${bookUlid}`;
	function queue(account = ownerId) {
		let q = queues.get(account);
		if (!q) queues.set(account, (q = new Map()));
		return q;
	}
	function journal(account = ownerId) {
		let j = recent.get(account);
		if (!j) recent.set(account, (j = new Map()));
		return j;
	}
	function readStorage(name: string) {
		try {
			return storage()?.getItem(name) ?? null;
		} catch {
			return null;
		}
	}
	function guestOwner() {
		if (guestOwnerId) return guestOwnerId;
		const stored = readStorage(GUEST_KEY);
		guestOwnerId = stored?.startsWith('guest:') ? stored : `guest:${crypto.randomUUID()}`;
		try {
			storage()?.setItem(GUEST_KEY, guestOwnerId);
		} catch {
			/* memory fallback */
		}
		return guestOwnerId;
	}
	function persist(account = ownerId) {
		try {
			const data = [...queue(account).values()];
			if (data.length) storage()?.setItem(PREFIX + account, JSON.stringify(data));
			else storage()?.removeItem(PREFIX + account);
		} catch {
			/* Continue saving from memory if browser storage is unavailable. */
		}
	}
	function load(account: string) {
		if (queues.has(account)) return;
		const q = queue(account);
		try {
			const parsed: unknown = JSON.parse(readStorage(PREFIX + account) ?? '[]');
			if (!Array.isArray(parsed)) return;
			for (const raw of parsed) {
				if (!validChange(raw, account)) continue;
				const c = { ...raw, book: validStoredBook(raw.book, raw) ? raw.book : undefined };
				// A reload cannot tell whether a request that was running committed.
				// Reapply desired state within the existing attempt budget.
				if (c.status === 'saving') c.status = c.attempts >= 4 ? 'failed' : 'pending';
				q.set(key(c), c);
				revision = Math.max(revision, c.revision);
			}
		} catch {
			/* Ignore invalid legacy/corrupt data; never invent an owner. */
		}
	}
	function initialize() {
		if (initialized) return;
		initialized = true;
		const memory = queue();
		ownerId = guestOwner();
		load(ownerId);
		for (const c of memory.values()) queue().set(key(c), { ...c, ownerId });
		persist();
		publish();
	}
	function publish() {
		const changes = [...queue().values()].map((c) => ({ ...c }));
		const failedCount = changes.filter((c) => c.status === 'failed').length;
		state.set({
			ownerId,
			changes,
			queuedCount: changes.length,
			failedCount,
			pendingCount: changes.length - failedCount,
			isFlushing: [...running.values()].some((r) => r.ownerId === ownerId)
		});
		for (const waiter of waiters) {
			const pending = changes.filter((c) => !waiter.kind || c.kind === waiter.kind);
			let failure: string | undefined;
			if (waiter.ownerId !== ownerId) failure = 'The active account changed.';
			else if (pending.some((c) => c.status === 'failed'))
				failure = 'Some library changes could not be saved.';
			else if (pending.some((c) => writers.get(c.kind)?.ownerId !== ownerId))
				failure = 'Waiting for the original account to connect.';
			if (failure || pending.length === 0) {
				waiters.delete(waiter);
				if (failure) waiter.reject(new Error(failure));
				else waiter.resolve();
			}
		}
	}
	function schedulePump() {
		if (pumpScheduled || disposed) return;
		pumpScheduled = true;
		queueMicrotask(() => {
			pumpScheduled = false;
			if (!disposed) pump();
		});
	}
	function pump() {
		clearTimeout(timer);
		timer = undefined;
		const ordered = [...queue().values()].sort((a, b) => a.revision - b.revision);
		for (const c of ordered) {
			if (running.size >= concurrency) break;
			if (c.status === 'failed' || c.status === 'saving') continue;
			const adapter = writers.get(c.kind);
			if (!adapter || adapter.ownerId !== ownerId || running.has(lane(ownerId, c.bookUlid)))
				continue;
			if (c.nextAttemptAt > Date.now()) continue;
			void save(c, adapter.write);
		}
		const deadlines = [...queue().values()]
			.filter(
				(c) =>
					c.status === 'retrying' &&
					c.nextAttemptAt > Date.now() &&
					writers.get(c.kind)?.ownerId === ownerId
			)
			.map((c) => c.nextAttemptAt);
		if (deadlines.length)
			timer = setTimeout(schedulePump, Math.max(0, Math.min(...deadlines) - Date.now()));
		publish();
	}
	async function save(c: PendingLibraryChange, write: Writer) {
		const account = c.ownerId;
		const laneKey = lane(account, c.bookUlid);
		const controller = new AbortController();
		const job = { ownerId: account, controller };
		running.set(laneKey, job);
		const saving: PendingLibraryChange = { ...c, status: 'saving', attempts: c.attempts + 1 };
		queue(account).set(key(c), saving);
		persist(account);
		publish();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let removeAbort: (() => void) | undefined;
		try {
			await Promise.race([
				Promise.resolve().then(() => {
					if (controller.signal.aborted) throw new Error('Account disconnected.');
					return write(saving, controller.signal);
				}),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(() => {
						reject(new Error('Saving the change timed out.'));
						controller.abort();
					}, timeoutMs);
					const abort = () => reject(new Error('Account disconnected.'));
					controller.signal.addEventListener('abort', abort, { once: true });
					removeAbort = () => controller.signal.removeEventListener('abort', abort);
				})
			]);
			if (queue(account).get(key(c))?.revision === c.revision) {
				queue(account).delete(key(c));
				// A read may start after the click but before this request commits.
				// Its snapshot must also be overlaid when the acknowledgment arrives first.
				journal(account).set(key(c), { ...c, revision: ++revision });
			}
			if (account === ownerId && ![...queue().values()].some((p) => p.bookUlid === c.bookUlid)) {
				for (const listener of savedListeners) listener(c.bookUlid);
			}
		} catch (reason) {
			if (queue(account).get(key(c))?.revision === c.revision) {
				const failure = failureDetails(reason);
				const failed = saving.attempts >= 4 || !failure.retryable;
				queue(account).set(key(c), {
					...saving,
					error: failure.error,
					errorKind: failure.errorKind,
					status: failed ? 'failed' : 'retrying',
					nextAttemptAt: failed ? 0 : Date.now() + RETRY_DELAYS[saving.attempts - 1]
				});
			}
		} finally {
			clearTimeout(timeout);
			removeAbort?.();
			if (running.get(laneKey) === job) running.delete(laneKey);
			persist(account);
			publish();
			schedulePump();
		}
	}

	const api = {
		subscribe: state.subscribe,
		initialize,
		getOwner: () => ownerId,
		getRevision: () => revision,
		activateOwner(accountId: string | null) {
			initialize();
			const next = accountId ?? guestOwner();
			if (next === ownerId) return;
			persist();
			ownerId = next;
			writers.clear();
			for (const job of running.values()) job.controller.abort();
			load(ownerId);
			publish();
			schedulePump();
		},
		/** Called only for the anonymous session established for this particular guest draft. */
		claimGuest(accountId: string, draftOwner: string) {
			initialize();
			if (!draftOwner.startsWith('guest:') || ownerId !== draftOwner) return;
			load(accountId);
			for (const c of queue(draftOwner).values()) {
				const claimed = { ...c, ownerId: accountId, revision: ++revision };
				queue(accountId).set(key(c), claimed);
				journal(accountId).set(key(c), claimed);
			}
			queue(draftOwner).clear();
			persist(draftOwner);
			persist(accountId);
			guestOwnerId = null;
			try {
				storage()?.removeItem(GUEST_KEY);
			} catch {
				/* memory fallback */
			}
		},
		setWriter(kind: LibrarySaveKind, write: Writer | null, account = ownerId) {
			if (account !== ownerId) return;
			if (write) writers.set(kind, { ownerId: account, write });
			else writers.delete(kind);
			publish();
			schedulePump();
		},
		enqueue(change: LibraryChange) {
			const c: PendingLibraryChange = {
				...change,
				ownerId,
				revision: ++revision,
				attempts: 0,
				status: 'pending',
				nextAttemptAt: 0
			};
			queue().set(key(c), c);
			journal().set(key(c), c);
			persist();
			publish();
			schedulePump();
		},
		/** Pending intentions always win; acknowledged mutations win over older reads only. */
		overlays(kind: LibrarySaveKind, readRevision = -1): PendingLibraryChange[] {
			const result = new Map<string, PendingLibraryChange>();
			for (const c of journal().values())
				if (c.kind === kind && c.revision > readRevision) result.set(key(c), c);
			for (const c of queue().values()) if (c.kind === kind) result.set(key(c), c);
			return [...result.values()].sort((a, b) => a.revision - b.revision);
		},
		flush(kind?: LibrarySaveKind): Promise<void> {
			const promise = new Promise<void>((resolve, reject) =>
				waiters.add({ ownerId, kind, resolve, reject })
			);
			publish();
			schedulePump();
			return promise;
		},
		retryFailed(): Promise<void> {
			for (const [k, c] of queue()) {
				if (c.status !== 'failed') continue;
				queue().set(k, {
					...c,
					attempts: 0,
					status: 'pending',
					nextAttemptAt: 0,
					error: undefined,
					errorKind: undefined
				});
			}
			persist();
			publish();
			return api.flush();
		},
		failGuest() {
			if (!ownerId.startsWith('guest:')) return;
			for (const [k, c] of queue())
				queue().set(k, {
					...c,
					status: 'failed',
					errorKind: 'authentication',
					error: 'Could not establish a session.'
				});
			persist();
			publish();
		},
		onBookSaved(callback: (bookUlid: string) => void) {
			savedListeners.add(callback);
			return () => savedListeners.delete(callback);
		},
		/** Explicit discard/reset for tests; sign-out uses activateOwner and preserves all queues. */
		discard(kind?: LibrarySaveKind) {
			for (const [k, c] of queue()) if (!kind || c.kind === kind) queue().delete(k);
			for (const [k, c] of journal()) if (!kind || c.kind === kind) journal().delete(k);
			persist();
			publish();
		},
		destroy() {
			disposed = true;
			clearTimeout(timer);
			for (const job of running.values()) job.controller.abort();
			for (const waiter of waiters) waiter.reject(new Error('Save controller stopped.'));
			waiters.clear();
		}
	};
	return api;
}

export const librarySaves = createLibrarySaveController();
