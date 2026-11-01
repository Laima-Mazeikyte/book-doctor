import { BOOK_CATALOG_SELECT } from '$lib/book-catalog-fields';
import type { Book } from '$lib/types/book';
import type { SupabaseClient } from '@supabase/supabase-js';

import { mapBookRowToBook, type BookCatalogRow } from './mapBookRowToBook';

/**
 * Load catalog rows for the given ULID `book_id`s and return `Book` instances
 * in the same order as `bookIds` (skips ids missing from the database).
 */
export async function resolveBooksByIdsInOrder(
	supabase: SupabaseClient,
	bookIds: string[]
): Promise<Book[]> {
	if (bookIds.length === 0) return [];

	const { data, error } = await supabase
		.from('books')
		.select(BOOK_CATALOG_SELECT)
		.in('book_id', bookIds);

	if (error) {
		throw new Error(error.message || 'Failed to resolve books');
	}

	const byBookId = new Map<string, Book>(
		((data ?? []) as unknown as BookCatalogRow[]).map(
			(row) => [row.book_id, mapBookRowToBook(row)] as const
		)
	);

	return bookIds.map((id) => byBookId.get(id)).filter((b): b is Book => b != null);
}
