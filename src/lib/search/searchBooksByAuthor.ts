import { browser } from '$app/environment';

import { BOOK_GENRE_TYPE_SELECT } from '$lib/book-catalog-fields';
import { getSupabase } from '$lib/supabase';

import { mapBookRowToBook, type BookCatalogRow } from './mapBookRowToBook';
import { SEARCH_MAX_LIMIT, type SearchResultPage } from './types';

function emptyResultPage(): SearchResultPage {
	return {
		books: [],
		nextOffset: 0,
		hasMore: false,
		source: 'db-author',
		loadedFields: []
	};
}

/**
 * Exact author match via Postgres (case-insensitive). Used for author-pill search
 * so results are not polluted by Meilisearch fuzzy title/author matching.
 */
export async function searchBooksByAuthor(
	author: string,
	offset = 0,
	limit = SEARCH_MAX_LIMIT
): Promise<SearchResultPage> {
	if (!browser) {
		return emptyResultPage();
	}

	const trimmed = author.trim();
	if (!trimmed) {
		return emptyResultPage();
	}

	const supabase = getSupabase();
	if (!supabase) {
		throw new Error(
			'Search is unavailable. Check that PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY are set.'
		);
	}

	const cappedLimit = Math.min(Math.max(1, limit), SEARCH_MAX_LIMIT);
	const rangeEnd = offset + cappedLimit - 1;

	const { data, error, count } = await supabase
		.from('books')
		.select(`id, book_id, book_name, author, cover_url, summary, year, ${BOOK_GENRE_TYPE_SELECT}`, {
			count: 'exact'
		})
		.ilike('author', trimmed)
		.order('book_name', { ascending: true })
		.range(offset, rangeEnd);

	if (error) {
		throw new Error(error.message || 'Failed to search books by author');
	}

	const books = (data ?? []).map((row) => mapBookRowToBook(row as BookCatalogRow));
	const nextOffset = offset + books.length;
	const total = count ?? nextOffset;
	const hasMore = nextOffset < total;

	return {
		books,
		nextOffset,
		hasMore,
		source: 'db-author',
		loadedFields: []
	};
}
