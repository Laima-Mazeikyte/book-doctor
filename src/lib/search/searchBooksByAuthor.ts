import { browser } from '$app/environment';

import { executeSearch } from './client';
import { emptyResultPage, SEARCH_MAX_LIMIT, type SearchResultPage } from './types';

/**
 * Exact author match via Edge `book-search` (`author` filter in Meilisearch), then
 * Postgres-backed resolution to `Book` rows. Browser-only; returns an empty page
 * during SSR.
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

	return executeSearch({ author: trimmed }, offset, limit);
}
