import { writable } from 'svelte/store';
import type { RatingValue } from '$lib/types/book';

export interface RatingsPersistence {
	set(bookIdNum: number, value: RatingValue): void | Promise<void>;
	remove(bookIdNum: number): void | Promise<void>;
}

/**
 * In-memory store for user book ratings. Persist to Supabase via setPersistence() from the layout.
 * Map of bookId (books.id) -> 1 | 2 | 3 | 4 | 5
 */
function createRatingsStore() {
	const { subscribe, set, update } = writable<Map<string, RatingValue>>(new Map());
	let persistence: RatingsPersistence | null = null;

	return {
		subscribe,
		/** Set callbacks to persist ratings to Supabase (upsert/delete). Called from layout after session exists. */
		setPersistence(p: RatingsPersistence | null) {
			persistence = p;
		},
		/** Hydrate the store from server data (e.g. after loading user_ratings from Supabase). */
		hydrate(entries: Array<{ bookId: string; rating: RatingValue }>) {
			set(new Map(entries.map((e) => [e.bookId, e.rating])));
		},
		setRating(bookId: string, value: RatingValue, bookIdNum?: number) {
			update((m) => {
				const next = new Map(m);
				next.set(bookId, value);
				return next;
			});
			if (bookIdNum != null && persistence) {
				void Promise.resolve(persistence.set(bookIdNum, value));
			}
		},
		removeRating(bookId: string, bookIdNum?: number) {
			update((m) => {
				const next = new Map(m);
				next.delete(bookId);
				return next;
			});
			if (bookIdNum != null && persistence) {
				void Promise.resolve(persistence.remove(bookIdNum));
			}
		},
		reset: () => set(new Map())
	};
}

export const ratingsStore = createRatingsStore();
