import type { SupabaseClient } from '@supabase/supabase-js';

type ReactionTable = 'user_ratings' | 'user_not_interested' | 'user_bookmarks';

function numericBookIds(rows: Array<{ book_id: unknown }> | null): number[] {
	return (rows ?? []).map((r) => r.book_id).filter((id): id is number => Number.isInteger(id));
}

async function loadReactionBookIds(
	supabase: SupabaseClient,
	table: ReactionTable
): Promise<number[]> {
	const { data, error } = await supabase.from(table).select('book_id');
	if (error) {
		console.error(`[feed] Failed to load ${table}:`, error);
		throw new Error(`Failed to load ${table}`);
	}
	return numericBookIds(data as Array<{ book_id: unknown }> | null);
}

export async function getRateFeedExcludedBookIds(supabase: SupabaseClient): Promise<Set<number>> {
	const [ratedIds, notInterestedIds, bookmarkedIds] = await Promise.all([
		loadReactionBookIds(supabase, 'user_ratings'),
		loadReactionBookIds(supabase, 'user_not_interested'),
		loadReactionBookIds(supabase, 'user_bookmarks')
	]);

	return new Set([...ratedIds, ...notInterestedIds, ...bookmarkedIds]);
}

export function excludeRateFeedBookIds<T extends { book_id?: number | null }>(
	books: T[],
	excludedBookIds: Set<number>
): T[] {
	if (excludedBookIds.size === 0) return books;
	return books.filter((book) => {
		const id = book.book_id;
		return id == null || !excludedBookIds.has(id);
	});
}
