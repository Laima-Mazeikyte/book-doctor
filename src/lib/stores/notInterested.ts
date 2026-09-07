import { get, writable } from 'svelte/store';

const LOCAL_STORAGE_KEY = 'book-doctor:not-interested:v2';

export interface NotInterestedPersistence {
	add(bookId: string): void | Promise<void>;
	remove(bookId: string): void | Promise<void>;
}

export interface NotInterestedChange {
	bookId: string;
	action: 'add' | 'remove';
	source: 'mutation' | 'hydrate';
}

/**
 * Store for "Not interested" books (recommendations the user dismissed).
 * Holds a Set of book_id ULIDs. Persist via API when authenticated, or localStorage when anonymous.
 */
function createNotInterestedStore() {
	const { subscribe, set, update } = writable<Set<string>>(new Set());
	let persistence: NotInterestedPersistence | null = null;
	const pendingOps = new Map<string, 'add' | 'remove'>();
	const pendingWrites = new Set<Promise<void>>();
	const changeListeners = new Set<(change: NotInterestedChange) => void>();

	function queuePendingOp(bookId: string, action: 'add' | 'remove') {
		pendingOps.set(bookId, action);
	}

	function notifyChange(change: NotInterestedChange): void {
		for (const listener of changeListeners) listener(change);
	}

	function applyHydratedIds(bookIds: string[]): void {
		const previous = get({ subscribe });
		const next = applyPendingOps(new Set(bookIds));
		set(next);
		for (const bookId of previous) {
			if (!next.has(bookId)) notifyChange({ bookId, action: 'remove', source: 'hydrate' });
		}
		for (const bookId of next) {
			if (!previous.has(bookId)) notifyChange({ bookId, action: 'add', source: 'hydrate' });
		}
	}

	function persist(action: 'add' | 'remove', bookId: string): void {
		if (!persistence) {
			queuePendingOp(bookId, action);
			return;
		}
		const pending = Promise.resolve(
			action === 'add' ? persistence.add(bookId) : persistence.remove(bookId)
		);
		pendingWrites.add(pending);
		void pending.catch(() => undefined).finally(() => pendingWrites.delete(pending));
	}

	function applyPendingOps(base: Set<string>): Set<string> {
		const next = new Set(base);
		for (const [bookId, action] of pendingOps) {
			if (action === 'add') next.add(bookId);
			else next.delete(bookId);
		}
		return next;
	}

	function flushPendingOps() {
		if (!persistence || pendingOps.size === 0) return Promise.resolve();
		const ops = [...pendingOps.entries()];
		pendingOps.clear();
		const pending = Promise.all(
			ops.map(([bookId, action]) =>
				action === 'add'
					? Promise.resolve(persistence!.add(bookId))
					: Promise.resolve(persistence!.remove(bookId))
			)
		).then(() => undefined);
		pendingWrites.add(pending);
		void pending.catch(() => undefined).finally(() => pendingWrites.delete(pending));
		return pending;
	}

	return {
		subscribe,
		/** Check if a book (by book_id ULID) is marked not interested. */
		has(bookId: string): boolean {
			return get({ subscribe }).has(bookId);
		},
		/** Get current book_id list (for persistence sync). */
		getBookIds(): string[] {
			return [...get({ subscribe })];
		},
		setPersistence(p: NotInterestedPersistence | null) {
			persistence = p;
			if (persistence) void flushPendingOps().catch(() => undefined);
		},
		onChange(listener: (change: NotInterestedChange) => void): () => void {
			changeListeners.add(listener);
			return () => changeListeners.delete(listener);
		},
		/** Hydrate from server (GET /api/not-interested) or after merge. */
		hydrate(bookIds: string[]) {
			applyHydratedIds(bookIds);
		},
		/** Hydrate from localStorage (anonymous user). */
		hydrateFromLocalStorage() {
			if (typeof window === 'undefined') return;
			try {
				const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
				if (raw) {
					const arr = JSON.parse(raw) as unknown;
					if (Array.isArray(arr) && arr.every((x) => typeof x === 'string')) {
						applyHydratedIds(arr);
					}
				}
			} catch {
				// ignore
			}
		},
		/** Persist current set to localStorage (call after add/remove when anonymous). */
		syncToLocalStorage() {
			if (typeof window === 'undefined') return;
			try {
				const ids = [...get({ subscribe })];
				if (ids.length === 0) {
					window.localStorage.removeItem(LOCAL_STORAGE_KEY);
				} else {
					window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(ids));
				}
			} catch {
				// ignore
			}
		},
		/** Clear localStorage (after merge on sign-in). */
		clearLocalStorage() {
			if (typeof window === 'undefined') return;
			try {
				window.localStorage.removeItem(LOCAL_STORAGE_KEY);
			} catch {
				// ignore
			}
		},
		/**
		 * Toggle not interested for a book.
		 * If currently not interested, removes (undo). Otherwise adds.
		 * Returns new state: true if now not interested, false if cleared.
		 */
		toggle(bookId: string): boolean {
			let next = false;
			update((s) => {
				const nextSet = new Set(s);
				if (nextSet.has(bookId)) {
					nextSet.delete(bookId);
					next = false;
					persist('remove', bookId);
					notifyChange({ bookId, action: 'remove', source: 'mutation' });
				} else {
					nextSet.add(bookId);
					next = true;
					persist('add', bookId);
					notifyChange({ bookId, action: 'add', source: 'mutation' });
				}
				return nextSet;
			});
			return next;
		},
		add(bookId: string) {
			update((s) => {
				if (s.has(bookId)) return s;
				const next = new Set(s);
				next.add(bookId);
				persist('add', bookId);
				notifyChange({ bookId, action: 'add', source: 'mutation' });
				return next;
			});
		},
		remove(bookId: string) {
			update((s) => {
				if (!s.has(bookId)) return s;
				const next = new Set(s);
				next.delete(bookId);
				persist('remove', bookId);
				notifyChange({ bookId, action: 'remove', source: 'mutation' });
				return next;
			});
		},
		reset() {
			set(new Set());
			pendingOps.clear();
		},
		async flushPending() {
			await flushPendingOps();
			if (pendingWrites.size > 0) await Promise.all([...pendingWrites]);
		}
	};
}

export const notInterestedStore = createNotInterestedStore();
