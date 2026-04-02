import { get, writable } from 'svelte/store';
import type { Book, RatingValue } from '$lib/types/book';
import { notInterestedStore } from './notInterested';

const LOCAL_STORAGE_KEY = 'book-doctor:ratings-pending';
const FLUSH_REQUEST_TIMEOUT_MS = 15_000;
const FLUSH_STALE_AFTER_MS = 20_000;

export interface RatingsPersistence {
	set(bookIdNum: number, value: RatingValue): void | Promise<void>;
	remove(bookIdNum: number): void | Promise<void>;
}

export type RatingSyncState = 'saved' | 'pending' | 'failed' | 'idle';

interface QueuedSetOperation {
	type: 'set';
	bookId: string;
	bookIdNum: number;
	value: RatingValue;
	book?: Book;
	updatedAt: number;
	attempts: number;
	lastError?: string;
}

interface QueuedRemoveOperation {
	type: 'remove';
	bookId: string;
	bookIdNum: number;
	updatedAt: number;
	attempts: number;
	lastError?: string;
}

type QueuedRatingOperation = QueuedSetOperation | QueuedRemoveOperation;

interface RatingsSyncMeta {
	pendingCount: number;
	failedCount: number;
	queuedCount: number;
	isFlushing: boolean;
}

function errorMessageFromUnknown(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === 'string' && error.trim()) return error;
	try {
		const serialized = JSON.stringify(error);
		return serialized && serialized !== '{}' ? serialized : 'Unknown ratings sync error';
	} catch {
		return 'Unknown ratings sync error';
	}
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string
): Promise<T> {
	let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutId = globalThis.setTimeout(() => {
					reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
				}, timeoutMs);
			})
		]);
	} finally {
		if (timeoutId != null) globalThis.clearTimeout(timeoutId);
	}
}

function serializeQueue(queue: Map<number, QueuedRatingOperation>): string {
	return JSON.stringify([...queue.values()]);
}

function parseQueue(raw: string | null): Map<number, QueuedRatingOperation> {
	if (!raw) return new Map();
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return new Map();
		const queue = new Map<number, QueuedRatingOperation>();
		for (const entry of parsed) {
			if (!entry || typeof entry !== 'object') continue;
			const op = entry as Partial<QueuedRatingOperation>;
			if (
				typeof op.bookId !== 'string' ||
				typeof op.bookIdNum !== 'number' ||
				!Number.isInteger(op.bookIdNum) ||
				typeof op.updatedAt !== 'number'
			) {
				continue;
			}
			if (op.type === 'set') {
				if (op.value == null || ![1, 2, 3, 4, 5].includes(op.value)) continue;
				queue.set(op.bookIdNum, {
					type: 'set',
					bookId: op.bookId,
					bookIdNum: op.bookIdNum,
					value: op.value as RatingValue,
					book: op.book,
					updatedAt: op.updatedAt,
					attempts: typeof op.attempts === 'number' ? op.attempts : 0,
					lastError: typeof op.lastError === 'string' ? op.lastError : undefined
				});
				continue;
			}
			if (op.type === 'remove') {
				queue.set(op.bookIdNum, {
					type: 'remove',
					bookId: op.bookId,
					bookIdNum: op.bookIdNum,
					updatedAt: op.updatedAt,
					attempts: typeof op.attempts === 'number' ? op.attempts : 0,
					lastError: typeof op.lastError === 'string' ? op.lastError : undefined
				});
			}
		}
		return queue;
	} catch {
		return new Map();
	}
}

/**
 * In-memory store for user book ratings. Persist to Supabase via setPersistence() from the layout.
 * Map of bookId (books.id) -> 1 | 2 | 3 | 4 | 5
 */
function createRatingsStore() {
	const { subscribe, set, update } = writable<Map<string, RatingValue>>(new Map());
	const ratedBooksDetails = writable<Map<string, Book>>(new Map());
	const syncStates = writable<Map<string, RatingSyncState>>(new Map());
	const syncMeta = writable<RatingsSyncMeta>({
		pendingCount: 0,
		failedCount: 0,
		queuedCount: 0,
		isFlushing: false
	});
	let persistence: RatingsPersistence | null = null;
	let queue = new Map<number, QueuedRatingOperation>();
	let queueHydrated = false;
	let isFlushing = false;
	let needsAnotherFlush = false;
	let flushStartedAt = 0;
	let flushGeneration = 0;
	let activeFlushGeneration = 0;

	function syncQueueToLocalStorage() {
		if (typeof window === 'undefined') return;
		try {
			if (queue.size === 0) {
				window.localStorage.removeItem(LOCAL_STORAGE_KEY);
				return;
			}
			window.localStorage.setItem(LOCAL_STORAGE_KEY, serializeQueue(queue));
		} catch {
			// ignore storage failures
		}
	}

	function setSyncMeta() {
		let pendingCount = 0;
		let failedCount = 0;
		for (const op of queue.values()) {
			if (op.lastError) failedCount += 1;
			else pendingCount += 1;
		}
		syncMeta.set({
			pendingCount,
			failedCount,
			queuedCount: queue.size,
			isFlushing
		});
	}

	function rebuildSyncStates(currentRatings?: Map<string, RatingValue>) {
		const ratings = currentRatings ?? get({ subscribe });
		const next = new Map<string, RatingSyncState>();
		for (const bookId of ratings.keys()) {
			next.set(bookId, 'saved');
		}
		for (const op of queue.values()) {
			if (op.type === 'set') {
				next.set(op.bookId, op.lastError ? 'failed' : 'pending');
			}
		}
		syncStates.set(next);
		setSyncMeta();
	}

	function applyQueuedOperations(baseRatings: Map<string, RatingValue>): Map<string, RatingValue> {
		const next = new Map(baseRatings);
		const queuedOps = [...queue.values()].sort((a, b) => a.updatedAt - b.updatedAt);
		for (const op of queuedOps) {
			if (op.type === 'set') next.set(op.bookId, op.value);
			else next.delete(op.bookId);
		}
		return next;
	}

	function applyQueuedBooksToDetails() {
		ratedBooksDetails.update((details) => {
			const next = new Map(details);
			for (const op of queue.values()) {
				if (op.type === 'set' && op.book != null) {
					next.set(op.bookId, op.book);
				}
				if (op.type === 'remove') {
					next.delete(op.bookId);
				}
			}
			return next;
		});
	}

	function upsertQueuedOperation(op: QueuedRatingOperation) {
		queue.set(op.bookIdNum, op);
		syncQueueToLocalStorage();
		rebuildSyncStates();
	}

	function clearQueuedOperation(bookIdNum: number) {
		queue.delete(bookIdNum);
		syncQueueToLocalStorage();
		rebuildSyncStates();
	}

	function markQueuedOperationFailed(op: QueuedRatingOperation, message: string) {
		const latest = queue.get(op.bookIdNum);
		if (!latest || latest.updatedAt !== op.updatedAt) return;
		queue.set(op.bookIdNum, {
			...latest,
			attempts: latest.attempts + 1,
			lastError: message
		});
		syncQueueToLocalStorage();
	}

	function clearQueuedOperationIfCurrent(op: QueuedRatingOperation) {
		const latest = queue.get(op.bookIdNum);
		if (!latest || latest.updatedAt !== op.updatedAt) return;
		clearQueuedOperation(op.bookIdNum);
	}

	function recoverStuckFlush(force = false): boolean {
		if (!isFlushing) return false;
		const runningForMs = Date.now() - flushStartedAt;
		if (!force && runningForMs < FLUSH_STALE_AFTER_MS) return false;
		console.warn('[ratings] Recovering stuck flush after', runningForMs, 'ms');
		isFlushing = false;
		flushStartedAt = 0;
		activeFlushGeneration = ++flushGeneration;
		setSyncMeta();
		return true;
	}

	async function flushPending(): Promise<void> {
		if (!persistence || queue.size === 0) return;
		recoverStuckFlush();
		if (isFlushing) {
			needsAnotherFlush = true;
			return;
		}

		const currentFlushGeneration = ++flushGeneration;
		activeFlushGeneration = currentFlushGeneration;
		isFlushing = true;
		flushStartedAt = Date.now();
		setSyncMeta();

		try {
			const queuedOps = [...queue.values()].sort((a, b) => a.updatedAt - b.updatedAt);
			for (const op of queuedOps) {
				if (activeFlushGeneration !== currentFlushGeneration) return;
				const current = queue.get(op.bookIdNum);
				if (!current || current.updatedAt !== op.updatedAt) continue;
				try {
					console.debug('[ratings] Flushing queued rating:', current.type, current.bookIdNum);
					if (current.type === 'set') {
						await withTimeout(
							Promise.resolve(persistence.set(current.bookIdNum, current.value)),
							FLUSH_REQUEST_TIMEOUT_MS,
							`Saving rating ${current.bookIdNum}`
						);
					} else {
						await withTimeout(
							Promise.resolve(persistence.remove(current.bookIdNum)),
							FLUSH_REQUEST_TIMEOUT_MS,
							`Removing rating ${current.bookIdNum}`
						);
					}
					if (activeFlushGeneration !== currentFlushGeneration) return;
					clearQueuedOperationIfCurrent(current);
					console.debug('[ratings] Flush succeeded:', current.type, current.bookIdNum);
				} catch (error) {
					if (activeFlushGeneration !== currentFlushGeneration) return;
					const message = errorMessageFromUnknown(error);
					markQueuedOperationFailed(current, message);
					console.error('[ratings] Flush failed:', current.bookIdNum, message);
				}
			}
		} finally {
			if (activeFlushGeneration !== currentFlushGeneration) return;
			isFlushing = false;
			flushStartedAt = 0;
			rebuildSyncStates();
			if (needsAnotherFlush) {
				needsAnotherFlush = false;
				void flushPending();
			}
		}
	}

	return {
		subscribe,
		/** Book details loaded with ratings (so the rating list can show all rated books after refresh). */
		ratedBooksDetails: { subscribe: ratedBooksDetails.subscribe },
		syncStates: { subscribe: syncStates.subscribe },
		syncMeta: { subscribe: syncMeta.subscribe },
		/** Set callbacks to persist ratings to Supabase (upsert/delete). Called from layout after session exists. */
		setPersistence(p: RatingsPersistence | null) {
			persistence = p;
			if (persistence) void flushPending();
			else setSyncMeta();
		},
		/** Set book details for rated books (from initial load). Used so findBookById can resolve all rated books. */
		setRatedBooksDetails(books: Map<string, Book>) {
			ratedBooksDetails.set(new Map(books));
			applyQueuedBooksToDetails();
		},
		/** Get book by id from loaded rated-book details (for rating list). */
		getRatedBook(bookId: string): Book | undefined {
			return get(ratedBooksDetails).get(bookId);
		},
		getSyncState(bookId: string): RatingSyncState {
			return get(syncStates).get(bookId) ?? (get({ subscribe }).has(bookId) ? 'saved' : 'idle');
		},
		hydratePendingFromLocalStorage() {
			if (queueHydrated || typeof window === 'undefined') return;
			queueHydrated = true;
			queue = parseQueue(window.localStorage.getItem(LOCAL_STORAGE_KEY));
			if (queue.size === 0) {
				setSyncMeta();
				return;
			}
			console.debug('[ratings] Hydrated pending queue from localStorage:', queue.size);
			update((ratings) => applyQueuedOperations(ratings));
			applyQueuedBooksToDetails();
			rebuildSyncStates();
		},
		/** Hydrate the store from server data (e.g. after loading user_ratings from Supabase). */
		hydrate(entries: Array<{ bookId: string; rating: RatingValue }>) {
			const baseRatings = new Map(entries.map((e) => [e.bookId, e.rating]));
			const next = applyQueuedOperations(baseRatings);
			set(next);
			rebuildSyncStates(next);
		},
		async flushPending() {
			await flushPending();
		},
		async retryPending() {
			if (queue.size === 0) return;
			recoverStuckFlush();
			if (isFlushing) {
				needsAnotherFlush = true;
				return;
			}
			queue = new Map(
				[...queue.entries()].map(([bookIdNum, op]) => [
					bookIdNum,
					{
						...op,
						lastError: undefined
					}
				])
			);
			syncQueueToLocalStorage();
			rebuildSyncStates();
			await flushPending();
		},
		setRating(bookId: string, value: RatingValue, bookIdNum?: number, book?: Book) {
			update((m) => {
				// Put this rating first so the side panel shows most recent at the top
				const next = new Map<string, RatingValue>();
				next.set(bookId, value);
				for (const [k, v] of m) {
					if (k !== bookId) next.set(k, v);
				}
				return next;
			});
			if (book != null) {
				ratedBooksDetails.update((m) => new Map(m).set(bookId, book));
			}
			if (bookIdNum != null) {
				const op: QueuedSetOperation = {
					type: 'set',
					bookId,
					bookIdNum,
					value,
					book,
					updatedAt: Date.now(),
					attempts: 0
				};
				console.debug('[ratings] Queueing rating locally:', bookIdNum, value);
				upsertQueuedOperation(op);
				void flushPending();
			}
			if (bookIdNum != null && bookIdNum !== 0) {
				notInterestedStore.remove(bookIdNum);
			}
		},
		removeRating(bookId: string, bookIdNum?: number) {
			update((m) => {
				const next = new Map(m);
				next.delete(bookId);
				return next;
			});
			ratedBooksDetails.update((m) => {
				const next = new Map(m);
				next.delete(bookId);
				return next;
			});
			if (bookIdNum != null) {
				const op: QueuedRemoveOperation = {
					type: 'remove',
					bookId,
					bookIdNum,
					updatedAt: Date.now(),
					attempts: 0
				};
				console.debug('[ratings] Queueing rating removal locally:', bookIdNum);
				upsertQueuedOperation(op);
				void flushPending();
			}
		},
		reset() {
			set(new Map());
			ratedBooksDetails.set(new Map());
			syncStates.set(new Map());
			queue = new Map();
			syncQueueToLocalStorage();
			setSyncMeta();
		}
	};
}

export const ratingsStore = createRatingsStore();
