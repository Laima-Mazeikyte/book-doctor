import type { Book, RatingValue } from '$lib/types/book';

/**
 * Route/screen key for unified BookCard. Drives which chrome and rating wiring apply.
 *
 * | context | Rating source | Body UI |
 * |---------|---------------|---------|
 * | `rate` | `ratingsStore` inside component | Cover + stars only; summary overlay |
 * | `bookmarks` | Parent props + callbacks | Actions + optional rate flow + overlay |
 * | `rated` | Parent props + callbacks | Typically stars-only when rated |
 * | `not-interested` | Parent props + callbacks | Actions + `notInterested` styling |
 * | `recommendations` | Parent props + callbacks | Full card; grid keyboard on parent |
 */
export type BookCardContext = 'rate' | 'bookmarks' | 'rated' | 'not-interested' | 'recommendations';

export type BookCardListProps = {
	book: Book;
	context: BookCardContext;
	/** Rate + overlay: fills search when user searches by author from summary */
	onSearchAuthor?: (author: string) => void;
	bookmarked?: boolean;
	onBookmark?: (bookId: string) => void;
	currentRating?: RatingValue | null;
	onRate?: (bookId: string, value: RatingValue) => void;
	onRemoveRating?: (bookId: string) => void;
	notInterested?: boolean;
	onNotInterested?: (bookId: string) => void;
};
