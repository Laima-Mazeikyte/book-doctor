import { resolve } from '$app/paths';

import type { Book } from '$lib/types/book';

import type { SearchResultPage } from './types';

export async function searchBooksViaApi(query: string, offset = 0): Promise<SearchResultPage> {
	const res = await fetch(resolve(`/api/books/search?q=${encodeURIComponent(query)}&offset=${offset}`));
	if (!res.ok) {
		throw new Error(`Fallback search failed with HTTP ${res.status}`);
	}

	const data: { books: Book[]; nextOffset: number; hasMore: boolean } = await res.json();

	return {
		books: data.books,
		nextOffset: data.nextOffset,
		hasMore: data.hasMore,
		source: 'api',
		loadedFields: []
	};
}
