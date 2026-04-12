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
	const pendingOps = new Map<string, { action: 'add' | 'remove'; bookIdNum: number }>();

	function queuePendingOp(bookId: string, bookIdNum: number, action: 'add' | 'remove') {
		pendingOps.set(bookId, { action, bookIdNum });
	}

	function applyPendingOps(base: Set<string>): Set<string> {
		const next = new Set(base);
		for (const [bookId, op] of pendingOps) {
			if (op.action === 'add') next.add(bookId);
			else next.delete(bookId);
		}
		return next;
	}

	function flushPendingOps() {
		if (!persistence || pendingOps.size === 0) return;
		for (const op of pendingOps.values()) {
			if (op.action === 'add') void Promise.resolve(persistence.add(op.bookIdNum));
			else void Promise.resolve(persistence.remove(op.bookIdNum));
		}
		pendingOps.clear();
	}

	return {
		subscribe,
		/** Check if a book (by books.id UUID) is bookmarked. */
		has(bookId: string): boolean {
			return get({ subscribe }).has(bookId);
		},
		/** Set callbacks to persist bookmarks to Supabase. Called from layout after session exists. */
		setPersistence(p: PlanToReadPersistence | null) {
			persistence = p;
			if (persistence) flushPendingOps();
		},
		/**
		 * Hydrate the store from server data (e.g. after loading /api/bookmarks).
		 * bookIds = array of books.id (UUID); optional idToNum map for persistence (id -> book_id integer).
		 */
		hydrate(bookIds: string[], idToNum?: Map<string, number>) {
			const nextIdToNum = idToNum != null ? new Map(idToNum) : new Map(get(bookIdToNum));
			for (const [bookId, op] of pendingOps) {
				nextIdToNum.set(bookId, op.bookIdNum);
			}
			set(applyPendingOps(new Set(bookIds)));
			bookIdToNum.set(nextIdToNum);
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
					if (num != null) {
						if (persistence) void Promise.resolve(persistence.remove(num));
						else queuePendingOp(bookId, num, 'remove');
					}
				} else {
					next.add(bookId);
					if (num != null) {
						nextNum = new Map(currentNum);
						nextNum.set(bookId, num);
						if (persistence) void Promise.resolve(persistence.add(num));
						else queuePendingOp(bookId, num, 'add');
					}
				}
				return next;
			});
			bookIdToNum.update((m) => (nextNum.size > 0 ? nextNum : m));
		},
		reset: () => {
			set(new Set());
			bookIdToNum.set(new Map());
			pendingOps.clear();
		}
	};
}

export const planToReadStore = createPlanToReadStore();
