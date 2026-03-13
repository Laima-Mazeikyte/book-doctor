import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchPopularBooks } from '$lib/server/googleBooks';
import { getStarterBooks } from '$lib/data/dummyBooks';

const INITIAL_BATCH = 30;
const SUBSEQUENT_BATCH = 20;

export const GET: RequestHandler = async ({ url }) => {
	const offsetParam = url.searchParams.get('offset');
	const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
	const maxResults = offset === 0 ? INITIAL_BATCH : SUBSEQUENT_BATCH;

	try {
		const books = await fetchPopularBooks(offset, maxResults);
		return json({ books, nextOffset: offset + books.length });
	} catch {
		// Fall back to dummy data so the page is never empty.
		const books = getStarterBooks();
		return json({ books, nextOffset: offset + books.length, fallback: true });
	}
};
