import type { Book } from '$lib/types/book';

/** Optional hooks so the ratings drawer book detail matches the rate page `BookCard` summary sheet. */
export type RatingsBarSummaryHooks = {
	onSearchAuthor?: (author: string) => void;
	onBookmark?: (book: Book) => void;
	onNotInterested?: (book: Book) => void;
	onAfterRate?: (book: Book) => void;
};
