import type { Book } from '$lib/types/book';

/** Minimum query length before search runs (UI may enforce this). */
export const SEARCH_MIN_QUERY_LENGTH = 3;

/** Default `limit` for each Edge / Meilisearch search request (books per round-trip). */
export const SEARCH_PAGE_SIZE = 50;

/** Hard cap passed to Edge / Meilisearch `limit` (cost and PostgREST `.in()` size). */
export const SEARCH_MAX_LIMIT = 50;

export type SearchResultSource = 'edge';

export interface SearchResultPage {
	books: Book[];
	nextOffset: number;
	hasMore: boolean;
	source: SearchResultSource;
	/** Unused for remote search; kept for call-site compatibility. */
	loadedFields: [];
}
