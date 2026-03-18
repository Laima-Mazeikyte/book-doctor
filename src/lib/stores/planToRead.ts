import { get, writable } from 'svelte/store';

export interface PlanToReadPersistence {
	add(bookIdNum: number): void | Promise<void>;
	remove(bookIdNum: number): void | Promise<void>;
}

/**
 * Store for "Plan to Read" bookmarks.
 * Holds a Set of book IDs (books.id UUID). Persist to Supabase via setPersistence() from the layout.
 * Use: $planToReadStore.has(bookId) for reactive check; planToReadStore.toggle(bookId, bookIdNum) to toggle.
 */
function createPlanToReadStore() {
	const { subscribe, set, update } = writable<Set<string>>(new Set());
	const bookIdToNum = writable<Map<string, number>>(new Map());
	let persistence: PlanToReadPersistence | null = null;

	return {
		subscribe,
		/** Check if a book (by books.id UUID) is bookmarked. */
		has(bookId: string): boolean {
			return get({ subscribe }).has(bookId);
		},
		/** Set callbacks to persist bookmarks to Supabase. Called from layout after session exists. */
		setPersistence(p: PlanToReadPersistence | null) {
			persistence = p;
		},
		/**
		 * Hydrate the store from server data (e.g. after loading /api/bookmarks).
		 * bookIds = array of books.id (UUID); optional idToNum map for persistence (id -> book_id integer).
		 */
		hydrate(bookIds: string[], idToNum?: Map<string, number>) {
			set(new Set(bookIds));
			if (idToNum != null) {
				bookIdToNum.set(new Map(idToNum));
			}
		},
		/**
		 * Toggle bookmark for a book.
		 * bookId = books.id (UUID); bookIdNum = books.book_id (integer) for API persistence.
		 */
		toggle: (bookId: string, bookIdNum?: number) => {
			let nextNum: Map<string, number> = new Map();
			update((s) => {
				const next = new Set(s);
				const currentNum = get(bookIdToNum);
				const num = bookIdNum ?? currentNum.get(bookId);
				if (next.has(bookId)) {
					next.delete(bookId);
					nextNum = new Map(currentNum);
					nextNum.delete(bookId);
					if (num != null && persistence) {
						void Promise.resolve(persistence.remove(num));
					}
				} else {
					next.add(bookId);
					if (num != null) {
						nextNum = new Map(currentNum);
						nextNum.set(bookId, num);
						if (persistence) {
							void Promise.resolve(persistence.add(num));
						}
					}
				}
				return next;
			});
			bookIdToNum.update((m) => (nextNum.size > 0 ? nextNum : m));
		},
		reset: () => {
			set(new Set());
			bookIdToNum.set(new Map());
		}
	};
}

export const planToReadStore = createPlanToReadStore();
