import { get, writable } from 'svelte/store';

export interface PlanToReadPersistence {
	add(bookId: string): void | Promise<void>;
	remove(bookId: string): void | Promise<void>;
}

/**
 * Store for "Plan to Read" bookmarks.
 * Holds a Set of book IDs (books.id UUID). Persist to Supabase via setPersistence() from the layout.
 * Use: $planToReadStore.has(bookId) for reactive check; planToReadStore.toggle(bookId, bookUlid) to toggle.
 */
function createPlanToReadStore() {
	const { subscribe, set, update } = writable<Set<string>>(new Set());
	const bookIdToUlid = writable<Map<string, string>>(new Map());
	let persistence: PlanToReadPersistence | null = null;
	const pendingOps = new Map<string, { action: 'add' | 'remove'; bookUlid: string }>();

	function queuePendingOp(bookId: string, bookUlid: string, action: 'add' | 'remove') {
		pendingOps.set(bookId, { action, bookUlid });
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
			if (op.action === 'add') void Promise.resolve(persistence.add(op.bookUlid));
			else void Promise.resolve(persistence.remove(op.bookUlid));
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
		 * bookIds = array of books.id (UUID); optional idToUlid map for persistence (id -> book_id ULID).
		 */
		hydrate(bookIds: string[], idToUlid?: Map<string, string>) {
			const nextIdToUlid = idToUlid != null ? new Map(idToUlid) : new Map(get(bookIdToUlid));
			for (const [bookId, op] of pendingOps) {
				nextIdToUlid.set(bookId, op.bookUlid);
			}
			set(applyPendingOps(new Set(bookIds)));
			bookIdToUlid.set(nextIdToUlid);
		},
		/**
		 * Toggle bookmark for a book.
		 * bookId = books.id (UUID); bookUlid = books.book_id (ULID) for API persistence.
		 */
		toggle: (bookId: string, bookUlid?: string) => {
			let nextUlid: Map<string, string> = new Map();
			update((s) => {
				const next = new Set(s);
				const currentUlid = get(bookIdToUlid);
				const ulid = bookUlid ?? currentUlid.get(bookId);
				if (next.has(bookId)) {
					next.delete(bookId);
					nextUlid = new Map(currentUlid);
					nextUlid.delete(bookId);
					if (ulid != null) {
						if (persistence) void Promise.resolve(persistence.remove(ulid));
						else queuePendingOp(bookId, ulid, 'remove');
					}
				} else {
					next.add(bookId);
					if (ulid != null) {
						nextUlid = new Map(currentUlid);
						nextUlid.set(bookId, ulid);
						if (persistence) void Promise.resolve(persistence.add(ulid));
						else queuePendingOp(bookId, ulid, 'add');
					}
				}
				return next;
			});
			bookIdToUlid.update((m) => (nextUlid.size > 0 ? nextUlid : m));
		},
		reset: () => {
			set(new Set());
			bookIdToUlid.set(new Map());
			pendingOps.clear();
		}
	};
}

export const planToReadStore = createPlanToReadStore();
