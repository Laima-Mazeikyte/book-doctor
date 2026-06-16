import type { SupabaseClient } from '@supabase/supabase-js';

export type BookIdJoinRow = {
	book_id: string;
	books?: {
		id: string;
		book_id: string;
	};
};

/**
 * Resolve the catalog UUID (`books.id`) for a user-library join row.
 * Returns null when the UUID cannot be resolved — never falls back to ULID (`book_id`).
 */
export function bookUuidFromJoinRow(
	row: BookIdJoinRow,
	uuidByUlid: Record<string, string>
): string | null {
	if (row.books?.id != null) return String(row.books.id);
	const resolved = uuidByUlid[row.book_id];
	return resolved ?? null;
}

export function bookmarkUlidFromRow(row: BookIdJoinRow): string {
	return row.books?.book_id ?? row.book_id;
}

export async function fetchUuidByUlid(
	supabase: SupabaseClient,
	bookIds: string[],
	isStale: () => boolean
): Promise<Record<string, string>> {
	if (bookIds.length === 0) return {};

	const { data: bookRows } = await supabase
		.from('books')
		.select('id, book_id')
		.in('book_id', bookIds);

	if (isStale()) return {};

	return Object.fromEntries((bookRows ?? []).map((b) => [b.book_id, String(b.id)])) as Record<
		string,
		string
	>;
}
