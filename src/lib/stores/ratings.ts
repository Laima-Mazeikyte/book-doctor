import { get, writable } from 'svelte/store';
import type { Book, RatingValue } from '$lib/types/book';

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
	const ratedBooksDetails = writable<Map<string, Book>>(new Map());
	let persistence: RatingsPersistence | null = null;

	return {
		subscribe,
		/** Book details loaded with ratings (so the rating list can show all rated books after refresh). */
		ratedBooksDetails: { subscribe: ratedBooksDetails.subscribe },
		/** Set callbacks to persist ratings to Supabase (upsert/delete). Called from layout after session exists. */
		setPersistence(p: RatingsPersistence | null) {
			persistence = p;
		},
		/** Set book details for rated books (from initial load). Used so findBookById can resolve all rated books. */
		setRatedBooksDetails(books: Map<string, Book>) {
			ratedBooksDetails.set(books);
		},
		/** Get book by id from loaded rated-book details (for rating list). */
		getRatedBook(bookId: string): Book | undefined {
			return get(ratedBooksDetails).get(bookId);
		},
		/** Hydrate the store from server data (e.g. after loading user_ratings from Supabase). */
		hydrate(entries: Array<{ bookId: string; rating: RatingValue }>) {
			set(new Map(entries.map((e) => [e.bookId, e.rating])));
		},
		setRating(bookId: string, value: RatingValue, bookIdNum?: number, book?: Book) {
			update((m) => {
				const next = new Map(m);
				next.set(bookId, value);
				return next;
			});
			if (book != null) {
				ratedBooksDetails.update((m) => new Map(m).set(bookId, book));
			}
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
			ratedBooksDetails.update((m) => {
				const next = new Map(m);
				next.delete(bookId);
				return next;
			});
			if (bookIdNum != null && persistence) {
				void Promise.resolve(persistence.remove(bookIdNum));
			}
		},
		reset() {
			set(new Map());
			ratedBooksDetails.set(new Map());
		}
	};
}

export const ratingsStore = createRatingsStore();
