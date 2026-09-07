import { fetchBooksByUlidsInOrder } from '$lib/server/catalogBooks';
import { parseRecommendationRank } from '$lib/server/recommendationFilters';
import type { Book } from '$lib/types/book';
import type { SupabaseClient } from '@supabase/supabase-js';

export const MAX_RECOMMENDATION_RANK = 10;

export type RecommendationPrecedentRow = {
	book_id?: unknown;
	request_id?: unknown;
	dimension_matches?: unknown;
	rank?: unknown;
	liked_book_precedent_ids?: unknown;
	author_relationship_evidence?: unknown;
};

export type LikedBookPrecedentsByBookId = Record<string, Book[]>;

/** Normalize the nullable database array while retaining its strongest-first order. */
export function normalizeLikedBookPrecedentIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];

	const ids: string[] = [];
	const seen = new Set<string>();
	for (const rawId of value) {
		if (typeof rawId !== 'string') continue;
		const id = rawId.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

/**
 * Resolve the first precedent list for each recommendation row in one catalog query.
 * Callers should pass rows in display priority order (newest run, then rank).
 */
export async function resolveLikedBookPrecedents(
	supabase: SupabaseClient,
	rows: RecommendationPrecedentRow[]
): Promise<LikedBookPrecedentsByBookId> {
	const idsByRecommendedBook = new Map<string, string[]>();
	const orderedPrecedentIds: string[] = [];
	const seenPrecedentIds = new Set<string>();

	for (const row of rows) {
		if (typeof row.book_id !== 'string') continue;

		const recommendedBookId = row.book_id.trim();
		const rank = parseRecommendationRank(row.rank);
		if (
			!recommendedBookId ||
			rank == null ||
			rank > MAX_RECOMMENDATION_RANK ||
			idsByRecommendedBook.has(recommendedBookId)
		) {
			continue;
		}

		const precedentIds = normalizeLikedBookPrecedentIds(row.liked_book_precedent_ids);
		idsByRecommendedBook.set(recommendedBookId, precedentIds);
		for (const precedentId of precedentIds) {
			if (seenPrecedentIds.has(precedentId)) continue;
			seenPrecedentIds.add(precedentId);
			orderedPrecedentIds.push(precedentId);
		}
	}

	if (orderedPrecedentIds.length === 0) {
		return Object.fromEntries([...idsByRecommendedBook].map(([bookId]) => [bookId, [] as Book[]]));
	}

	const precedentBooks = await fetchBooksByUlidsInOrder(supabase, orderedPrecedentIds);
	const bookById = new Map(precedentBooks.map((book) => [book.book_id, book]));

	return Object.fromEntries(
		[...idsByRecommendedBook].map(([bookId, precedentIds]) => [
			bookId,
			precedentIds
				.map((precedentId) => bookById.get(precedentId))
				.filter((book): book is Book => book != null)
		])
	);
}
