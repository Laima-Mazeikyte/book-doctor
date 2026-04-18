import { get, writable } from 'svelte/store';
import type { Book } from '$lib/types/book';

interface BookmarksPageState {
	books: Book[];
	loaded: boolean;
}

function createBookmarksPageStore() {
	const { subscribe, set, update } = writable<BookmarksPageState>({
		books: [],
		loaded: false
	});

	return {
		subscribe,
		getSnapshot(): BookmarksPageState {
			return get({ subscribe });
		},
		setBooks(books: Book[]) {
			set({
				books: [...books],
				loaded: true
			});
		},
		removeBook(bookId: string) {
			update((state) => ({
				...state,
				books: state.books.filter((book) => book.id !== bookId),
				loaded: true
			}));
		},
		reset() {
			set({
				books: [],
				loaded: false
			});
		}
	};
}

export const bookmarksPageStore = createBookmarksPageStore();
