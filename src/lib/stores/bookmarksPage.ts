import { get, writable } from 'svelte/store';
import type { Book } from '$lib/types/book';

interface BookmarksPageState {
	userId: string | null;
	books: Book[];
	loaded: boolean;
}

function createBookmarksPageStore() {
	const { subscribe, set, update } = writable<BookmarksPageState>({
		userId: null,
		books: [],
		loaded: false
	});

	return {
		subscribe,
		ensureUser(userId: string) {
			if (get({ subscribe }).userId !== userId) set({ userId, books: [], loaded: false });
		},
		getSnapshot(): BookmarksPageState {
			return get({ subscribe });
		},
		setBooks(books: Book[]) {
			set({
				userId: get({ subscribe }).userId,
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
				userId: null,
				books: [],
				loaded: false
			});
		}
	};
}

export const bookmarksPageStore = createBookmarksPageStore();
