import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchBooks } from '$lib/server/googleBooks';
import { searchBooks as searchDummyBooks } from '$lib/data/dummyBooks';

const MAX_RESULTS = 10;

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';

	if (!query) {
		return json({ books: [] });
	}

	try {
		const books = await searchBooks(query, MAX_RESULTS);
		return json({ books });
	} catch {
		// Fall back to dummy data on API failure.
		const books = searchDummyBooks(query);
		return json({ books, fallback: true });
	}
};
