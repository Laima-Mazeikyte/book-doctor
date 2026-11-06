import { withRequestTimeout } from '$lib/server/requestTimeout';
import { error, json } from '@sveltejs/kit';
import type { AuthorBookSummary, AuthorBooksResponse } from '$lib/books/authorBooks';
import { supabase } from '$lib/server/supabase';
import type { RequestHandler } from './$types';

const AUTHOR_BOOK_LIMIT = 48;

export const GET: RequestHandler = withRequestTimeout(async ({ url }, signal) => {
	const author = url.searchParams.get('author') ?? '';
	if (!author.trim() || author.length > 500) error(400, 'Missing or invalid author');
	const { data, error: booksError } = await supabase
		.from('books')
		.select('book_id,slug,title:book_name')
		.eq('author', author)
		.order('year', { ascending: true, nullsFirst: false })
		.order('book_name')
		.order('book_id')
		.limit(AUTHOR_BOOK_LIMIT + 1)
		.abortSignal(signal);
	if (booksError) {
		console.error('[books/by-author] Failed to load author books:', booksError);
		error(503, 'Author books are temporarily unavailable');
	}
	const rows = data ?? [];
	const books = rows.slice(0, AUTHOR_BOOK_LIMIT).map((row): AuthorBookSummary => {
		if (
			typeof row.book_id !== 'string' ||
			!row.book_id.trim() ||
			typeof row.slug !== 'string' ||
			!row.slug.trim() ||
			typeof row.title !== 'string' ||
			!row.title.trim()
		) {
			throw new Error('Invalid author-book catalog identity');
		}
		return { book_id: row.book_id, slug: row.slug, title: row.title };
	});
	return json({
		books,
		truncated: rows.length > AUTHOR_BOOK_LIMIT
	} satisfies AuthorBooksResponse);
}, 503);
