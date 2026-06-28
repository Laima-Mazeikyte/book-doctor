import { browser } from '$app/environment';

import { getSupabase } from '$lib/supabase';

import { invokeBookSearch } from './bookSearchEdge';
import { resolveBooksByIdsInOrder } from './resolveBooksFromSupabase';
import {
	emptyResultPage,
	SEARCH_MAX_LIMIT,
	SEARCH_UNAVAILABLE_MESSAGE,
	type SearchResultPage
} from './types';

/**
 * Whether another Meilisearch page may exist. `estimatedTotalHits` is sometimes
 * low/incorrect through proxies; a full `hits` page still implies more. Empty
 * `hits` must stop pagination even if an inflated estimate says otherwise.
 */
export function computeSearchHasMore(
	scannedHitCount: number,
	cappedLimit: number,
	nextOffset: number,
	estimatedTotalHits: number | null
): boolean {
	if (scannedHitCount <= 0) return false;
	return (
		scannedHitCount >= cappedLimit ||
		(estimatedTotalHits != null && nextOffset < estimatedTotalHits)
	);
}

/** Search selector: either a fuzzy `q` query or an exact `author` filter. */
type SearchSelector = { q: string } | { author: string };

/**
 * Shared pipeline for both search modes: Edge Function `book-search`
 * (Meilisearch proxy) then Postgres-backed resolution to `Book` rows. Callers
 * are responsible for the `browser`/trim/empty-query guards before calling.
 */
export async function executeSearch(
	selector: SearchSelector,
	offset: number,
	limit: number
): Promise<SearchResultPage> {
	const supabase = getSupabase();
	if (!supabase) {
		throw new Error(SEARCH_UNAVAILABLE_MESSAGE);
	}

	const cappedLimit = Math.min(Math.max(1, limit), SEARCH_MAX_LIMIT);

	const { bookIds, estimatedTotalHits, scannedHitCount } = await invokeBookSearch(supabase, {
		...selector,
		limit: cappedLimit,
		offset
	});

	const books = await resolveBooksByIdsInOrder(supabase, bookIds);
	// Advance Meilisearch `offset` by raw hit count so it stays aligned with ranking (dedupe is display-only).
	const nextOffset = offset + scannedHitCount;
	const hasMore = computeSearchHasMore(
		scannedHitCount,
		cappedLimit,
		nextOffset,
		estimatedTotalHits
	);

	return {
		books,
		nextOffset,
		hasMore,
		source: 'edge',
		loadedFields: []
	};
}

/**
 * Full-text book search: Edge Function `book-search` (Meilisearch proxy) then
 * Postgres-backed resolution to `Book` rows. Browser-only; returns an empty
 * page during SSR.
 */
export async function searchBooks(
	query: string,
	offset = 0,
	limit = SEARCH_MAX_LIMIT
): Promise<SearchResultPage> {
	if (!browser) {
		return emptyResultPage();
	}

	const trimmed = query.trim();
	if (!trimmed) {
		return emptyResultPage();
	}

	return executeSearch({ q: trimmed }, offset, limit);
}
