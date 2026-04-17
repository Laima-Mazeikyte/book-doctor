import type { Book, RatingValue } from '$lib/types/book';

/**
 * Route/screen key for unified BookCard. Drives which chrome and rating wiring apply.
 *
 * | context | Rating source | Body UI |
 * |---------|---------------|---------|
 * | `rate` | `ratingsStore` inside component | Cover: bookmark / not-interested / summary pills; body stars; summary overlay |
 * | `bookmarks` | Parent props + callbacks | Same chrome + stars as `rate` (callbacks drive pills) |
 * | `rated` | Parent props + callbacks | Same as `bookmarks` |
 * | `recommendations` | Parent props + callbacks | Same as `bookmarks`; grid keyboard on parent |
 * | `not-interested` | Parent props + callbacks | Same chrome + stars as `rate` |
 */
export type BookCardContext = 'rate' | 'bookmarks' | 'rated' | 'not-interested' | 'recommendations';

export type BookCardListProps = {
	book: Book;
	context: BookCardContext;
	/**
	 * Summary sheet: search by author. When omitted, navigates to `/rate?q=…`.
	 * Pass this on the rate page to fill search in-page (avoids URL round-trip; preserves scroll helpers).
	 */
	onSearchAuthor?: (author: string) => void;
	bookmarked?: boolean;
	onBookmark?: (bookId: string) => void;
	currentRating?: RatingValue | null;
	onRate?: (bookId: string, value: RatingValue) => void;
	onRemoveRating?: (bookId: string) => void;
	notInterested?: boolean;
	onNotInterested?: (bookId: string) => void;
	/** Rate context: called after star rating is set or cleared (for parent scroll/feed logic). */
	onAfterRate?: (book: Book) => void;
};
