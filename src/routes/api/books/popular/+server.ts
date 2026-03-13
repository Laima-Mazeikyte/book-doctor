import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBooksPage } from '$lib/data/dummyBooks';

const INITIAL_BATCH = 30;
const SUBSEQUENT_BATCH = 20;

export const GET: RequestHandler = async ({ url }) => {
	const offsetParam = url.searchParams.get('offset');
	const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
	const maxResults = offset === 0 ? INITIAL_BATCH : SUBSEQUENT_BATCH;

	const books = getBooksPage(offset, maxResults);
	return json({ books, nextOffset: offset + books.length });
};
