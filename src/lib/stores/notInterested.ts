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
		},
		/** Hydrate from server (GET /api/not-interested) or after merge. */
		hydrate(bookIds: number[]) {
			set(new Set(bookIds));
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
					void Promise.resolve(persistence?.remove(bookIdNum));
				} else {
					nextSet.add(bookIdNum);
					next = true;
					void Promise.resolve(persistence?.add(bookIdNum));
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
				void Promise.resolve(persistence?.add(bookIdNum));
				return next;
			});
		},
		remove(bookIdNum: number) {
			update((s) => {
				if (!s.has(bookIdNum)) return s;
				const next = new Set(s);
				next.delete(bookIdNum);
				void Promise.resolve(persistence?.remove(bookIdNum));
				return next;
			});
		},
		reset() {
			set(new Set());
		}
	};
}

export const notInterestedStore = createNotInterestedStore();
