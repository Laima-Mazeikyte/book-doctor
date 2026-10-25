import { FEED_REQUEST_BATCH_SIZE } from '$lib/feed/constants';
import { type BookGenreSlotRow } from '$lib/book-catalog-fields';
import type { LatestRateFeedMode } from '$lib/rate/feedEligibility';
import { mapBookRowToBook } from '$lib/search/mapBookRowToBook';
import type { SupabaseClient } from '@supabase/supabase-js';

export type FeedBookPayload = {
	id: string;
	book_id: string;
	title: string;
	author: string;
	coverUrl?: string;
	summary?: string;
	year?: string;
	genres?: string[];
	type?: string;
};

export type FeedJsonResponse = {
	status: string;
	books: FeedBookPayload[];
	request_id: string;
	error_message: string | null;
};

export type LatestEligibleRateFeedMode = LatestRateFeedMode;

export type LatestEligibleRateFeedPayload = FeedJsonResponse & {
	mode: LatestEligibleRateFeedMode;
	latest_request_id: string | null;
	latest_request_status: string | null;
	latest_request_error_message: string | null;
	ratings_count: number;
	interaction_count: number;
	eligible_for_feed: boolean;
};

/** Preserve access failures without exposing Supabase's internal error details. */
export class FeedAccessError extends Error {
	constructor(public readonly status: 401 | 403) {
		super(status === 401 ? 'Authentication required' : 'Feed access denied');
		this.name = 'FeedAccessError';
	}
}

type EligibleFeedBookRow = {
	id: string;
	book_id: string;
	book_name: string | null;
	author: string | null;
	summary: string | null;
	year: number | null;
	rank: number;
} & BookGenreSlotRow & { type?: string | null };

type LatestRateFeedBootstrap = Omit<LatestEligibleRateFeedPayload, 'books'> & {
	books: EligibleFeedBookRow[];
};

function mapEligibleFeedRows(rows: EligibleFeedBookRow[]): FeedBookPayload[] {
	return rows.map((row) => mapBookRowToBook(row));
}

function isLatestRateFeedBootstrap(value: unknown): value is LatestRateFeedBootstrap {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
	const payload = value as Partial<LatestRateFeedBootstrap>;
	return (
		payload.mode != null &&
		[
			'has_eligible_feed',
			'feed_exhausted',
			'feed_generation_pending',
			'no_feed_yet',
			'feed_error',
			'below_threshold'
		].includes(payload.mode) &&
		typeof payload.status === 'string' &&
		typeof payload.request_id === 'string' &&
		[
			payload.error_message,
			payload.latest_request_id,
			payload.latest_request_status,
			payload.latest_request_error_message
		].every((field) => field === null || typeof field === 'string') &&
		typeof payload.ratings_count === 'number' &&
		Number.isSafeInteger(payload.ratings_count) &&
		payload.ratings_count >= 0 &&
		typeof payload.interaction_count === 'number' &&
		Number.isSafeInteger(payload.interaction_count) &&
		payload.interaction_count >= payload.ratings_count &&
		typeof payload.eligible_for_feed === 'boolean' &&
		Array.isArray(payload.books) &&
		payload.books.every(
			(book) => book != null && typeof book.id === 'string' && typeof book.book_id === 'string'
		)
	);
}

export async function loadLatestEligibleRateFeed(
	supabase: SupabaseClient,
	limit = FEED_REQUEST_BATCH_SIZE,
	recordTiming?: (name: string, durationMs: number) => void
): Promise<LatestEligibleRateFeedPayload> {
	async function readBootstrap() {
		const started = performance.now();
		try {
			return await supabase.rpc('get_rate_feed_bootstrap', { p_limit: limit });
		} finally {
			recordTiming?.('feed_bootstrap', performance.now() - started);
		}
	}

	const { data, error, status } = await readBootstrap();
	if (error) {
		console.error('[feed] get_rate_feed_bootstrap failed:', error);
		if (status === 401 || status === 403) throw new FeedAccessError(status);
		throw new Error('Failed to load latest eligible feed');
	}

	// A broken RPC contract must surface as a load failure, not as an empty feed
	// that could send the client down its generation/fallback path.
	if (!isLatestRateFeedBootstrap(data)) {
		throw new Error('Invalid latest feed bootstrap response');
	}

	return {
		mode: data.mode,
		status: data.status,
		books: mapEligibleFeedRows(data.books),
		request_id: data.request_id,
		latest_request_id: data.latest_request_id,
		latest_request_status: data.latest_request_status,
		latest_request_error_message: data.latest_request_error_message,
		ratings_count: data.ratings_count,
		interaction_count: data.interaction_count,
		eligible_for_feed: data.eligible_for_feed,
		error_message: data.error_message
	};
}

async function loadEligibleFeedBooks(
	supabase: SupabaseClient,
	requestId: string,
	limit: number
): Promise<FeedBookPayload[]> {
	const { data, error } = await supabase.rpc('get_eligible_feed_books', {
		p_request_id: requestId,
		p_limit: limit
	});

	if (error) {
		console.error('[feed] get_eligible_feed_books failed:', error);
		throw new Error('Failed to load eligible feed books');
	}

	return mapEligibleFeedRows((data ?? []) as EligibleFeedBookRow[]);
}

/**
 * Build feed JSON for a single feed_requests.id (same behavior as GET /api/feed?request_id=).
 * Eligibility is enforced in Postgres via get_eligible_feed_books.
 */
export async function buildFeedPayloadForRequest(
	supabase: SupabaseClient,
	requestId: string,
	limit = 100
): Promise<FeedJsonResponse> {
	const { data: feedReq, error: reqError } = await supabase
		.from('feed_requests')
		.select('status, error_message')
		.eq('id', requestId)
		.maybeSingle();

	if (reqError) {
		throw new Error('Failed to load feed request');
	}

	if (!feedReq) {
		throw new Error('Feed request not found');
	}

	const status = feedReq.status as string;
	const errorMessage = feedReq.error_message ?? null;

	if (status === 'failed' || status === 'skipped') {
		return {
			status,
			books: [],
			request_id: requestId,
			error_message: errorMessage
		};
	}

	if (status !== 'completed') {
		return {
			status,
			books: [],
			request_id: requestId,
			error_message: errorMessage
		};
	}

	const books = await loadEligibleFeedBooks(supabase, requestId, limit);

	return {
		status: 'completed',
		books,
		request_id: requestId,
		error_message: errorMessage
	};
}
