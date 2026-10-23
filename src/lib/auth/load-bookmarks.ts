import { get } from 'svelte/store';
import { resolve } from '$app/paths';
import { authStore } from '$lib/stores/auth';
import { bookmarksPageStore } from '$lib/stores/bookmarksPage';
import { libraryLoads } from '$lib/stores/libraryLoads';
import { librarySaves } from '$lib/stores/librarySaves';
import { planToReadStore } from '$lib/stores/planToRead';
import type { Book } from '$lib/types/book';

/** Shared by the bookshelf and ratings drawer, including their refresh/retry requests. */
export function loadBookmarkDetails(userId: string, refresh = false): Promise<void> {
	const isCurrent = () => get(authStore).user?.id === userId && librarySaves.getOwner() === userId;
	if (!isCurrent()) return Promise.resolve();
	bookmarksPageStore.ensureUser(userId);
	libraryLoads.register(
		userId,
		'bookmarkDetails',
		async (signal) => {
			const readRevision = librarySaves.getRevision();
			const token = get(authStore).session?.access_token;
			if (!token) throw Object.assign(new Error('Session unavailable.'), { status: 401 });
			const response = await fetch(resolve('/api/bookmarks'), {
				headers: { Authorization: `Bearer ${token}` },
				signal
			});
			if (!response.ok)
				throw Object.assign(new Error('Could not load bookmarks.'), { status: response.status });
			const data = (await response.json()) as { books?: Book[] };
			if (!Array.isArray(data.books)) throw new Error('Could not load bookmarks.');
			const books = data.books;
			return () => bookmarksPageStore.setBooks(planToReadStore.mergeBooks(books, readRevision));
		},
		0,
		isCurrent
	);
	return refresh ? libraryLoads.retry(['bookmarkDetails']) : libraryLoads.load('bookmarkDetails');
}
