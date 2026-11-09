import { BOOK_CATALOG_SELECT } from '$lib/book-catalog-fields';
import { mapBookRowToBook, type BookCatalogRow } from '$lib/search/mapBookRowToBook';
import type { Book } from '$lib/types/book';
import type { SupabaseClient } from '@supabase/supabase-js';

const CATALOG_BATCH_SIZE = 100;
const MAX_CONCURRENT_CATALOG_BATCHES = 3;

export const CATALOG_SELECT = BOOK_CATALOG_SELECT;

function uniqueIds(bookIds: string[]): string[] {
	return [...new Set(bookIds)];
}

async function fetchCatalogRows(
	supabase: SupabaseClient,
	bookIds: string[],
	selection = CATALOG_SELECT
): Promise<BookCatalogRow[]> {
	const uniqueBookIds = uniqueIds(bookIds);
	if (uniqueBookIds.length === 0) return [];

	const batches: string[][] = [];
	for (let i = 0; i < uniqueBookIds.length; i += CATALOG_BATCH_SIZE) {
		batches.push(uniqueBookIds.slice(i, i + CATALOG_BATCH_SIZE));
	}

	const rows: BookCatalogRow[] = [];
	for (let i = 0; i < batches.length; i += MAX_CONCURRENT_CATALOG_BATCHES) {
		const concurrentBatches = batches.slice(i, i + MAX_CONCURRENT_CATALOG_BATCHES);
		const results = await Promise.all(
			concurrentBatches.map(async (batch) => {
				const { data, error: booksError } = await supabase
					.from('books')
					.select(selection)
					.in('book_id', batch);
				if (booksError) throw booksError;
				return (data ?? []) as unknown as BookCatalogRow[];
			})
		);
		for (const result of results) rows.push(...result);
	}

	return rows;
}

export async function fetchBooksByUlidsInOrder(
	supabase: SupabaseClient,
	orderedBookIds: string[]
): Promise<Book[]> {
	const uniqueOrderedBookIds = uniqueIds(orderedBookIds);
	if (uniqueOrderedBookIds.length === 0) return [];

	const booksData = await fetchCatalogRows(supabase, uniqueOrderedBookIds);

	const bookByUlid = new Map(
		(booksData ?? []).map((b) => [b.book_id, mapBookRowToBook(b as BookCatalogRow)])
	);

	return orderedBookIds.map((bookId) => bookByUlid.get(bookId)).filter((b): b is Book => b != null);
}

export async function fetchBooksByUlids(
	supabase: SupabaseClient,
	bookIds: string[]
): Promise<Book[]> {
	const booksData = await fetchCatalogRows(supabase, bookIds);

	return (booksData ?? []).map((b) => mapBookRowToBook(b as BookCatalogRow));
}

/** Picker identities only; synopsis/evidence is fetched if the reader opens details. */
export async function fetchSelectionBooksByUlids(
	supabase: SupabaseClient,
	bookIds: string[]
): Promise<Book[]> {
	const rows = await fetchCatalogRows(
		supabase,
		bookIds,
		'id, book_id, slug, book_name, author, year'
	);
	return rows.map((row) => {
		const book = mapBookRowToBook(row);
		// Missing is distinct from a known empty synopsis in the details-panel cache.
		delete book.summary;
		return book;
	});
}
