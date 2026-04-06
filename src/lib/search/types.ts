import type { Book } from '$lib/types/book';

/**
 * Static search bundle contract (see `scripts/build-search-index.mjs`):
 * - `static/search/manifest.msgpack` — version, per-field shard descriptors, document blob path
 * - `documents.msgpack` — `SearchBookDocument[]` (same shape as `/api/books/search` books)
 * - `title.msgpack` | `author.msgpack` | `keyword.msgpack` — FlexSearch `export()` chunk arrays
 */
export const SEARCH_ASSET_VERSION = 1;
export const SEARCH_MIN_QUERY_LENGTH = 3;
export const SEARCH_PAGE_SIZE = 24;

export const SEARCH_FIELDS = ['title', 'author', 'keyword'] as const;

export type SearchIndexField = (typeof SEARCH_FIELDS)[number];
export type SearchAssetLoadPhase = 'focus' | 'deferred';
export type SearchResultSource = 'flexsearch' | 'api';

export type ExportChunk = [key: string, data: string];

export type SearchBookDocument = Book;

export interface SearchAssetDescriptor {
	file: string;
	bytes: number;
	chunkCount: number;
}

export interface SearchFieldDescriptor extends SearchAssetDescriptor {
	field: SearchIndexField;
	weight: number;
	loadPhase: SearchAssetLoadPhase;
}

export interface SearchIndexManifest {
	version: number;
	generatedAt: string;
	documentCount: number;
	documents: SearchAssetDescriptor;
	fields: Record<SearchIndexField, SearchFieldDescriptor>;
}

export interface SearchResultPage {
	books: Book[];
	nextOffset: number;
	hasMore: boolean;
	source: SearchResultSource;
	loadedFields: SearchIndexField[];
}

export type SearchWorkerRequest =
	| {
			id: number;
			type: 'warmTitle';
			assetBase: string;
	  }
	| {
			id: number;
			type: 'warmRemaining';
			assetBase: string;
	  }
	| {
			id: number;
			type: 'search';
			assetBase: string;
			query: string;
			offset: number;
			limit: number;
	  };

export type SearchWorkerResponse =
	| {
			id: number;
			type: 'ready';
			loadedFields: SearchIndexField[];
	  }
	| {
			id: number;
			type: 'search-result';
			result: SearchResultPage;
	  }
	| {
			id: number;
			type: 'error';
			message: string;
	  };
