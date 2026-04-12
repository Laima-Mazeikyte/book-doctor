import { get, writable } from 'svelte/store';

const LOCAL_STORAGE_KEY = 'book-doctor:not-interested';

export interface NotInterestedPersistence {
	add(bookIdNum: number): void | Promise<void>;
	remove(bookIdNum: number): void | Promise<void>;
}

/**
 * Store for "Not interested" books (recommendations the user dismissed).
 * Holds a Set of book_id (number). Persist via API when authenticated, or localStorage when anonymous.
 */
function createNotInterestedStore() {
	const { subscribe, set, update } = writable<Set<number>>(new Set());
	let persistence: NotInterestedPersistence | null = null;
	const pendingOps = new Map<number, 'add' | 'remove'>();

	function queuePendingOp(bookIdNum: number, action: 'add' | 'remove') {
		pendingOps.set(bookIdNum, action);
	}

	function applyPendingOps(base: Set<number>): Set<number> {
		const next = new Set(base);
		for (const [bookIdNum, action] of pendingOps) {
			if (action === 'add') next.add(bookIdNum);
			else next.delete(bookIdNum);
		}
		return next;
	}

	function flushPendingOps() {
		if (!persistence || pendingOps.size === 0) return;
		for (const [bookIdNum, action] of pendingOps) {
			if (action === 'add') void Promise.resolve(persistence.add(bookIdNum));
			else void Promise.resolve(persistence.remove(bookIdNum));
		}
		pendingOps.clear();
	}

	return {
		subscribe,
		/** Check if a book (by book_id number) is marked not interested. */
		has(bookIdNum: number): boolean {
			return get({ subscribe }).has(bookIdNum);
		},
		/** Get current book_id list (for persistence sync). */
		getBookIds(): number[] {
			return [...get({ subscribe })];
		},
		setPersistence(p: NotInterestedPersistence | null) {
			persistence = p;
			if (persistence) flushPendingOps();
		},
		/** Hydrate from server (GET /api/not-interested) or after merge. */
		hydrate(bookIds: number[]) {
			set(applyPendingOps(new Set(bookIds)));
		},
		/** Hydrate from localStorage (anonymous user). */
		hydrateFromLocalStorage() {
			if (typeof window === 'undefined') return;
			try {
				const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
				if (raw) {
					const arr = JSON.parse(raw) as unknown;
					if (Array.isArray(arr) && arr.every((x) => typeof x === 'number')) {
						set(new Set(arr));
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
		toggle(bookIdNum: number): boolean {
			let next = false;
			update((s) => {
				const nextSet = new Set(s);
				if (nextSet.has(bookIdNum)) {
					nextSet.delete(bookIdNum);
					next = false;
					if (persistence) void Promise.resolve(persistence.remove(bookIdNum));
					else queuePendingOp(bookIdNum, 'remove');
				} else {
					nextSet.add(bookIdNum);
					next = true;
					if (persistence) void Promise.resolve(persistence.add(bookIdNum));
					else queuePendingOp(bookIdNum, 'add');
				}
				return nextSet;
			});
			return next;
		},
		add(bookIdNum: number) {
			update((s) => {
				if (s.has(bookIdNum)) return s;
				const next = new Set(s);
				next.add(bookIdNum);
				if (persistence) void Promise.resolve(persistence.add(bookIdNum));
				else queuePendingOp(bookIdNum, 'add');
				return next;
			});
		},
		remove(bookIdNum: number) {
			update((s) => {
				if (!s.has(bookIdNum)) return s;
				const next = new Set(s);
				next.delete(bookIdNum);
				if (persistence) void Promise.resolve(persistence.remove(bookIdNum));
				else queuePendingOp(bookIdNum, 'remove');
				return next;
			});
		},
		reset() {
			set(new Set());
			pendingOps.clear();
		}
	};
}

export const notInterestedStore = createNotInterestedStore();
