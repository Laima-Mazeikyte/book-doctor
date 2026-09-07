import type { Book, RatingValue } from '$lib/types/book';

/**
 * Keep only recommendation precedents with an explicit liked rating.
 * Book.id is the catalog UUID used as the key in ratingsStore.
 */
export function filterRatedLikedBookPrecedents(
	precedents: readonly Book[] | null | undefined,
	ratingsByBookId: ReadonlyMap<string, RatingValue>
): Book[] {
	return (precedents ?? []).filter((book) => {
		const rating = ratingsByBookId.get(book.id);
		return rating === 4 || rating === 5;
	});
}
