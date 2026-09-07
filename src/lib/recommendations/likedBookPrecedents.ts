import type { Book } from '$lib/types/book';

/**
 * Keep only recommendation precedents that have an explicit user rating.
 * Book.id is the catalog UUID used as the key in ratingsStore.
 */
export function filterRatedLikedBookPrecedents(
	precedents: readonly Book[] | null | undefined,
	ratedBookIds: ReadonlySet<string>
): Book[] {
	return (precedents ?? []).filter((book) => ratedBookIds.has(book.id));
}
