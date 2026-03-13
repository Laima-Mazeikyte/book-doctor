import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchBooks } from '$lib/data/dummyBooks';

const MAX_RESULTS = 10;

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';

	if (!query) {
		return json({ books: [] });
	}

	const books = searchBooks(query).slice(0, MAX_RESULTS);
	return json({ books });
};
