import { writable } from 'svelte/store';
import type { RatingValue } from '$lib/types/book';

/**
 * In-memory store for user book ratings. Replace with persisted store/API when connecting backend.
 * Map of bookId -> 1 | 2 | 3 | 4 | 5
 */
function createRatingsStore() {
	const { subscribe, set, update } = writable<Map<string, RatingValue>>(new Map());

	return {
		subscribe,
		setRating(bookId: string, value: RatingValue) {
			update((m) => {
				const next = new Map(m);
				next.set(bookId, value);
				return next;
			});
		},
		removeRating(bookId: string) {
			update((m) => {
				const next = new Map(m);
				next.delete(bookId);
				return next;
			});
		},
		reset: () => set(new Map())
	};
}

export const ratingsStore = createRatingsStore();
