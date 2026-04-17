import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';
import {
	BOOK_GENRE_TYPE_SELECT,
	catalogTypeFromRow,
	genresFromGenreColumns,
	type BookGenreSlotRow
} from '$lib/book-catalog-fields';
import type { Book } from '$lib/types/book';
import type { SupabaseClient } from '@supabase/supabase-js';

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

	const base = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');

	const byBookId = new Map<number, Book>(
		(data ?? []).map((b) => {
			const row = b as typeof b & BookGenreSlotRow & { type?: string | null };
			const type = catalogTypeFromRow(row);
			const book: Book = {
				id: String(b.id),
				book_id: b.book_id,
				title: b.book_name ?? '',
				author: b.author ?? '',
				coverUrl: b.cover_url ?? (base ? `${base}/${b.book_id}.avif` : undefined),
				summary: b.summary ?? undefined,
				year: b.year != null ? String(b.year) : undefined,
				genres: genresFromGenreColumns(row),
				...(type ? { type } : {})
			};
			return [b.book_id, book] as const;
		})
	);

	return bookIds.map((id) => byBookId.get(id)).filter((b): b is Book => b != null);
}
