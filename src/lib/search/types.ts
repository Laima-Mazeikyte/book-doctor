import type { Book } from '$lib/types/book';

/** Minimum query length before search runs (UI may enforce this). */
export const SEARCH_MIN_QUERY_LENGTH = 3;

/** Hard cap passed to Edge / Meilisearch `limit` (cost and PostgREST `.in()` size). */
export const SEARCH_MAX_LIMIT = 50;

export interface SearchResultPage {
	books: Book[];
	nextOffset: number;
	hasMore: boolean;
}

/** Shared error message when the Supabase client is unavailable (missing env). */
export const SEARCH_UNAVAILABLE_MESSAGE =
	'Search is unavailable. Check that PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY are set.';

/** Empty page returned during SSR or for blank queries. */
export function emptyResultPage(): SearchResultPage {
	return {
		books: [],
		nextOffset: 0,
		hasMore: false
	};
}
