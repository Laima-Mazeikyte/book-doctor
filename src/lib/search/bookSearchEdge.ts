import type { SupabaseClient } from '@supabase/supabase-js';

/** Name of the Supabase Edge Function (Meilisearch proxy). */
export const BOOK_SEARCH_FUNCTION = 'book-search';

export type BookSearchInvokeBody = {
	/** Meilisearch-style search string */
	q: string;
	limit: number;
	offset: number;
};

export type MeilisearchHit = Record<string, unknown>;

function unwrapSearchPayload(data: unknown): Record<string, unknown> {
	if (!data || typeof data !== 'object') return {};
	const o = data as Record<string, unknown>;
	if (Array.isArray(o.hits)) return o;
	const nested = o.result ?? o.data;
	if (
		nested &&
		typeof nested === 'object' &&
		Array.isArray((nested as Record<string, unknown>).hits)
	) {
		return nested as Record<string, unknown>;
	}
	return o;
}

/**
 * Read numeric catalog id from a Meilisearch hit (index is tuned for `book_id`).
 */
export function extractBookIdFromHit(hit: MeilisearchHit): number | null {
	const v = hit.book_id ?? hit.bookId;
	if (typeof v === 'number' && Number.isInteger(v)) return v;
	if (typeof v === 'string') {
		const n = parseInt(v, 10);
		return Number.isNaN(n) ? null : n;
	}
	return null;
}

/** Preserve hit order; drop invalid ids and accidental duplicates. */
export function orderedUniqueBookIds(hits: MeilisearchHit[]): number[] {
	const out: number[] = [];
	const seen = new Set<number>();
	for (const hit of hits) {
		const id = extractBookIdFromHit(hit);
		if (id == null || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

function readEstimatedTotal(payload: Record<string, unknown>): number | null {
	const raw = payload.estimatedTotalHits ?? payload.estimatedTotal;
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
	if (typeof raw === 'string') {
		const n = parseInt(raw, 10);
		if (Number.isFinite(n)) return n;
	}
	return null;
}

export type BookSearchEdgeResult = {
	bookIds: number[];
	/** From Meilisearch when present; otherwise callers infer `hasMore` from page size. */
	estimatedTotalHits: number | null;
	/** Raw `hits.length` — use this (not deduped id count) for the next `offset`. */
	scannedHitCount: number;
};

/**
 * Calls the Edge function and returns ordered `book_id` values from `hits`.
 * Body uses Meilisearch-style `q`, `limit`, and `offset`.
 */
export async function invokeBookSearch(
	supabase: SupabaseClient,
	body: BookSearchInvokeBody
): Promise<BookSearchEdgeResult> {
	const { data, error } = await supabase.functions.invoke(BOOK_SEARCH_FUNCTION, { body });

	if (error) {
		throw new Error(error.message || `${BOOK_SEARCH_FUNCTION} request failed`);
	}

	const payload = unwrapSearchPayload(data);
	if (typeof payload.error === 'string' && payload.error.trim()) {
		throw new Error(payload.error);
	}

	const hits = Array.isArray(payload.hits) ? (payload.hits as MeilisearchHit[]) : [];
	const scannedHitCount = hits.length;
	const bookIds = orderedUniqueBookIds(hits);
	const estimatedTotalHits = readEstimatedTotal(payload);

	return { bookIds, estimatedTotalHits, scannedHitCount };
}
