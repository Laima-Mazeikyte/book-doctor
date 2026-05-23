import {
	BOOK_GENRE_TYPE_SELECT,
	type BookGenreSlotRow
} from '$lib/book-catalog-fields';
import type { Book } from '$lib/types/book';
import type { SupabaseClient } from '@supabase/supabase-js';

import { mapBookRowToBook } from './mapBookRowToBook';

/**
 * Load catalog rows for the given numeric `book_id`s and return `Book` instances
 * in the same order as `bookIds` (skips ids missing from the database).
 */
export async function resolveBooksByNumericIdsInOrder(
	supabase: SupabaseClient,
	bookIds: number[]
): Promise<Book[]> {
	if (bookIds.length === 0) return [];

	const { data, error } = await supabase
		.from('books')
		.select(`id, book_id, book_name, author, cover_url, summary, year, ${BOOK_GENRE_TYPE_SELECT}`)
		.in('book_id', bookIds);

	if (error) {
		throw new Error(error.message || 'Failed to resolve books');
	}

	const byBookId = new Map<number, Book>(
		(data ?? []).map((b) => {
			const row = b as typeof b & BookGenreSlotRow & { type?: string | null };
			return [b.book_id, mapBookRowToBook(row)] as const;
		})
	);

	return bookIds.map((id) => byBookId.get(id)).filter((b): b is Book => b != null);
}
