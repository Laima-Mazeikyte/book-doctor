import type { Book, RatingValue } from '$lib/types/book';

/** Ordered author candidates for each recommended catalog book. */
export type AuthorRelationshipAuthorsByBookId = Record<string, string[]>;

type AuthorRelationshipEvidenceRow = {
	book_id?: unknown;
	author_relationship_evidence?: unknown;
};

type RatedBookForAuthorRelationships = {
	book: Pick<Book, 'author'>;
	rating: RatingValue;
};

/** Normalize the nullable JSONB array while retaining backend ordering and string entries. */
export function normalizeAuthorRelationshipEvidence(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: [];
}

/**
 * Build an ordered candidate map. Rows must be passed in priority order; the first row for a
 * book therefore wins, including when that newest row has NULL evidence.
 */
export function buildAuthorRelationshipAuthorsByBookId(
	rows: readonly AuthorRelationshipEvidenceRow[]
): AuthorRelationshipAuthorsByBookId {
	const authorsByBookId: AuthorRelationshipAuthorsByBookId = {};

	for (const row of rows) {
		if (typeof row.book_id !== 'string') continue;
		const bookId = row.book_id.trim();
		if (!bookId || Object.prototype.hasOwnProperty.call(authorsByBookId, bookId)) continue;
		authorsByBookId[bookId] = normalizeAuthorRelationshipEvidence(row.author_relationship_evidence);
	}

	return authorsByBookId;
}

/** Return authors with at least one clean-like rating and no explicit low rating. */
export function buildCleanLikedAuthorSet(
	ratedBooks: readonly RatedBookForAuthorRelationships[]
): Set<string> {
	const authorRatings = new Map<string, { hasLikedRating: boolean; hasLowRating: boolean }>();

	for (const { book, rating } of ratedBooks) {
		const author = book.author?.trim();
		if (!author) continue;

		const current = authorRatings.get(author) ?? {
			hasLikedRating: false,
			hasLowRating: false
		};
		if (rating === 4 || rating === 5) current.hasLikedRating = true;
		if (rating === 1 || rating === 2 || rating === 3) current.hasLowRating = true;
		authorRatings.set(author, current);
	}

	return new Set(
		[...authorRatings]
			.filter(([, ratings]) => ratings.hasLikedRating && !ratings.hasLowRating)
			.map(([author]) => author)
	);
}

/** Filter ordered candidates to explicitly clean-liked authors, keeping at most three. */
export function filterAuthorRelationshipAuthors(
	candidates: readonly string[] | null | undefined,
	cleanLikedAuthors: ReadonlySet<string>
): string[] {
	return (candidates ?? []).filter((author) => cleanLikedAuthors.has(author)).slice(0, 3);
}
