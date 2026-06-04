import type { SupabaseClient } from '@supabase/supabase-js';

type ReactionTable = 'user_ratings' | 'user_not_interested' | 'user_bookmarks';

function stringBookIds(rows: Array<{ book_id: unknown }> | null): string[] {
	return (rows ?? [])
		.map((r) => (typeof r.book_id === 'string' ? r.book_id.trim() : ''))
		.filter((id) => id.length > 0);
}

async function loadReactionBookIds(
	supabase: SupabaseClient,
	table: ReactionTable
): Promise<string[]> {
	const { data, error } = await supabase.from(table).select('book_id');
	if (error) {
		console.error(`[feed] Failed to load ${table}:`, error);
		throw new Error(`Failed to load ${table}`);
	}
	return stringBookIds(data as Array<{ book_id: unknown }> | null);
}

export async function getRateFeedExcludedBookIds(supabase: SupabaseClient): Promise<Set<string>> {
	const [ratedIds, notInterestedIds, bookmarkedIds] = await Promise.all([
		loadReactionBookIds(supabase, 'user_ratings'),
		loadReactionBookIds(supabase, 'user_not_interested'),
		loadReactionBookIds(supabase, 'user_bookmarks')
	]);

	return new Set([...ratedIds, ...notInterestedIds, ...bookmarkedIds]);
}

export function excludeRateFeedBookIds<T extends { book_id?: string | null }>(
	books: T[],
	excludedBookIds: Set<string>
): T[] {
	if (excludedBookIds.size === 0) return books;
	return books.filter((book) => {
		const id = book.book_id?.trim();
		return !id || !excludedBookIds.has(id);
	});
}
