import { writable } from 'svelte/store';

/**
 * Stub store for "Plan to Read" bookmarks.
 * Holds a Set of book IDs. API/DB persistence to be wired later.
 * Use: $planToReadStore.has(bookId) for reactive check; planToReadStore.toggle(bookId) to toggle.
 */
function createPlanToReadStore() {
	const { subscribe, set, update } = writable<Set<string>>(new Set());

	return {
		subscribe,
		/** Toggle bookmark for a book. Stub: in-memory only. */
		toggle: (bookId: string) => {
			update((s) => {
				const next = new Set(s);
				if (next.has(bookId)) {
					next.delete(bookId);
				} else {
					next.add(bookId);
				}
				return next;
			});
		},
		reset: () => set(new Set())
	};
}

export const planToReadStore = createPlanToReadStore();
