import { get, writable } from 'svelte/store';
import type { Book } from '$lib/types/book';

interface BookmarksPageState {
	userId: string | null;
	books: Book[];
	loaded: boolean;
}

function createBookmarksPageStore() {
	let loadedAt = 0;
	const { subscribe, set, update } = writable<BookmarksPageState>({
		userId: null,
		books: [],
		loaded: false
	});

	return {
		subscribe,
		ensureUser(userId: string) {
			if (get({ subscribe }).userId !== userId) {
				loadedAt = 0;
				set({ userId, books: [], loaded: false });
			}
		},
		getSnapshot(): BookmarksPageState {
			return get({ subscribe });
		},
		setBooks(books: Book[]) {
			loadedAt = Date.now();
			set({
				userId: get({ subscribe }).userId,
				books: [...books],
				loaded: true
			});
		},
		needsRefresh() {
			return !get({ subscribe }).loaded || Date.now() - loadedAt >= 60_000;
		},
		removeBook(bookId: string) {
			update((state) => ({
				...state,
				books: state.books.filter((book) => book.id !== bookId),
				loaded: true
			}));
		},
		reset() {
			loadedAt = 0;
			set({
				userId: null,
				books: [],
				loaded: false
			});
		}
	};
}

export const bookmarksPageStore = createBookmarksPageStore();
