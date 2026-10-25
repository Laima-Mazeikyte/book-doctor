import type { Book, QualityBand } from '$lib/types/book';

export const RATE_FEED_CACHE_PREFIX = 'book-doctor:rate-feed:v1:';
export const RATE_FEED_CACHE_MAX_AGE_MS = 24 * 60 * 60_000;
export const RATE_FEED_CACHE_MAX_BOOKS = 100;
const MAX_CACHE_CHARS = 1_500_000;

export type CachedRateFeedSource =
	| { kind: 'curated'; requestId: string | null }
	| { kind: 'popular'; requestId: null; seed: string | null; nextOffset: number; hasMore: boolean };
export type CachedRateFeed = {
	version: 1;
	ownerId: string;
	fetchedAt: number;
	source: CachedRateFeedSource;
	books: Book[];
};
export interface RateFeedCache {
	read(ownerId: string): CachedRateFeed | null;
	write(snapshot: CachedRateFeed): void;
	clear(ownerId: string): void;
}
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

function browserStorage() {
	return typeof window === 'undefined' ? null : window.localStorage;
}
function object(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
function string(value: unknown, limit: number): value is string {
	return typeof value === 'string' && value.length <= limit;
}
function identifier(value: unknown): value is string {
	return string(value, 200) && value.length > 0;
}
function nullableId(value: unknown): value is string | null {
	return value === null || identifier(value);
}
function book(value: unknown): Book | null {
	if (
		!object(value) ||
		!identifier(value.id) ||
		!identifier(value.book_id) ||
		!string(value.title, 2000) ||
		!string(value.author, 2000)
	)
		return null;
	const result: Book = {
		id: value.id,
		book_id: value.book_id,
		title: value.title,
		author: value.author
	};
	for (const [key, limit] of [
		['summary', 100_000],
		['year', 64],
		['type', 200],
		['coverUrl', 2048]
	] as const) {
		if (value[key] === undefined) continue;
		if (!string(value[key], limit)) return null;
		result[key] = value[key];
	}
	if (result.coverUrl) {
		try {
			if (!['http:', 'https:'].includes(new URL(result.coverUrl).protocol)) return null;
		} catch {
			return null;
		}
	}
	if (value.genres !== undefined) {
		if (
			!Array.isArray(value.genres) ||
			value.genres.length > 7 ||
			!value.genres.every((genre) => string(genre, 200))
		)
			return null;
		result.genres = [...value.genres];
	}
	if (value.qualityBand !== undefined) {
		if (
			value.qualityBand !== null &&
			(typeof value.qualityBand !== 'string' ||
				![
					'top_0_1_percent',
					'top_1_percent',
					'top_5_percent',
					'top_10_percent',
					'top_25_percent',
					'below_top_25'
				].includes(value.qualityBand))
		)
			return null;
		result.qualityBand = value.qualityBand as QualityBand | null;
	}
	return result;
}

/** A cache contains display candidates and pagination hints, never credentials or generation state. */
function parse(
	value: unknown,
	ownerId: string,
	now: number,
	maxAgeMs: number
): CachedRateFeed | null {
	if (
		!object(value) ||
		value.version !== 1 ||
		value.ownerId !== ownerId ||
		!identifier(ownerId) ||
		!Number.isSafeInteger(value.fetchedAt) ||
		(value.fetchedAt as number) < 0 ||
		(value.fetchedAt as number) > now ||
		now - (value.fetchedAt as number) >= maxAgeMs ||
		!object(value.source) ||
		!Array.isArray(value.books) ||
		!value.books.length ||
		value.books.length > RATE_FEED_CACHE_MAX_BOOKS
	)
		return null;
	const s = value.source;
	let source: CachedRateFeedSource;
	if (s.kind === 'curated' && nullableId(s.requestId)) {
		source = { kind: 'curated', requestId: s.requestId };
	} else if (
		s.kind === 'popular' &&
		s.requestId === null &&
		nullableId(s.seed) &&
		Number.isSafeInteger(s.nextOffset) &&
		(s.nextOffset as number) >= 0 &&
		typeof s.hasMore === 'boolean'
	) {
		source = {
			kind: 'popular',
			requestId: null,
			seed: s.seed,
			nextOffset: s.nextOffset as number,
			hasMore: s.hasMore
		};
	} else return null;
	const books = value.books.map(book);
	if (books.some((row) => row === null)) return null;
	const valid = books as Book[];
	if (
		new Set(valid.map((row) => row.id)).size !== valid.length ||
		new Set(valid.map((row) => row.book_id)).size !== valid.length
	)
		return null;
	return { version: 1, ownerId, fetchedAt: value.fetchedAt as number, source, books: valid };
}

export function createRateFeedCache({
	storage = browserStorage,
	now = Date.now,
	maxAgeMs = RATE_FEED_CACHE_MAX_AGE_MS
}: {
	storage?: StorageAccess;
	now?: () => number;
	maxAgeMs?: number;
} = {}): RateFeedCache {
	return {
		read(ownerId) {
			try {
				const raw = storage()?.getItem(RATE_FEED_CACHE_PREFIX + ownerId);
				return raw && raw.length <= MAX_CACHE_CHARS
					? parse(JSON.parse(raw), ownerId, now(), maxAgeMs)
					: null;
			} catch {
				return null;
			}
		},
		write(snapshot) {
			try {
				const safe = parse(snapshot, snapshot.ownerId, now(), maxAgeMs);
				if (!safe) return;
				const raw = JSON.stringify(safe);
				if (raw.length <= MAX_CACHE_CHARS)
					storage()?.setItem(RATE_FEED_CACHE_PREFIX + safe.ownerId, raw);
			} catch {
				/* Disposable cache: quota/blocked storage falls back to ordinary loading. */
			}
		},
		clear(ownerId) {
			try {
				storage()?.removeItem(RATE_FEED_CACHE_PREFIX + ownerId);
			} catch {
				/* Keep pending-save journals independent. */
			}
		}
	};
}
