import { BOOK_GENRE_TYPE_SELECT } from '$lib/book-catalog-fields';
import { mapBookRowToBook, type BookCatalogRow } from '$lib/search/mapBookRowToBook';
import type { Book } from '$lib/types/book';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function fetchBooksByUlidsInOrder(
	supabase: SupabaseClient,
	orderedBookIds: string[]
): Promise<Book[]> {
	if (orderedBookIds.length === 0) return [];

	const { data: booksData, error: booksError } = await supabase
		.from('books')
		.select(`id, book_id, book_name, author, summary, year, ${BOOK_GENRE_TYPE_SELECT}`)
		.in('book_id', orderedBookIds);

	if (booksError) throw booksError;

	const bookByUlid = new Map(
		(booksData ?? []).map((b) => [b.book_id, mapBookRowToBook(b as BookCatalogRow)])
	);

	return orderedBookIds.map((bookId) => bookByUlid.get(bookId)).filter((b): b is Book => b != null);
}

export async function fetchBooksByUlids(
	supabase: SupabaseClient,
	bookIds: string[]
): Promise<Book[]> {
	if (bookIds.length === 0) return [];

	const { data: booksData, error: booksError } = await supabase
		.from('books')
		.select(`id, book_id, book_name, author, summary, year, ${BOOK_GENRE_TYPE_SELECT}`)
		.in('book_id', bookIds);

	if (booksError) throw booksError;

	return (booksData ?? []).map((b) => mapBookRowToBook(b as BookCatalogRow));
}
