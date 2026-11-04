import { error, json } from '@sveltejs/kit';
import { CATALOG_SELECT } from '$lib/server/catalogBooks';
import { mapBookRowToBook, type BookCatalogRow } from '$lib/search/mapBookRowToBook';
import { supabase } from '$lib/server/supabase';
import type { RequestHandler } from './$types';

const AUTHOR_BOOK_LIMIT = 48;

export const GET: RequestHandler = async ({ url }) => {
	const author = url.searchParams.get('author') ?? '';
	if (!author.trim() || author.length > 500) error(400, 'Missing or invalid author');
	const { data, error: booksError } = await supabase
		.from('books')
		.select(CATALOG_SELECT)
		.eq('author', author)
		.order('year', { ascending: true, nullsFirst: false })
		.order('book_name')
		.order('book_id')
		.limit(AUTHOR_BOOK_LIMIT + 1);
	if (booksError) {
		console.error('[books/by-author] Failed to load author books:', booksError);
		error(503, 'Author books are temporarily unavailable');
	}
	const rows = (data ?? []) as unknown as BookCatalogRow[];
	return json({
		books: rows.slice(0, AUTHOR_BOOK_LIMIT).map(mapBookRowToBook),
		truncated: rows.length > AUTHOR_BOOK_LIMIT
	});
};
