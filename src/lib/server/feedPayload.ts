import { type BookGenreSlotRow } from '$lib/book-catalog-fields';
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

export type LatestEligibleRateFeedPayload = FeedJsonResponse & {
	latest_request_id: string | null;
	latest_request_status: string | null;
};

type EligibleFeedBookRow = {
	id: string;
	book_id: string;
	book_name: string | null;
	author: string | null;
	summary: string | null;
	year: number | null;
	rank: number;
} & BookGenreSlotRow & { type?: string | null };

type LatestRateFeedStateRow = EligibleFeedBookRow & {
	latest_request_id?: number | string | null;
	latest_request_status?: string | null;
	latest_completed_request_id?: number | string | null;
};

function stringOrNull(value: number | string | null | undefined): string | null {
	if (value == null) return null;
	const s = String(value).trim();
	return s || null;
}

function mapEligibleFeedRows(rows: EligibleFeedBookRow[]): FeedBookPayload[] {
	return rows.map((row) => mapBookRowToBook(row));
}

export async function loadLatestEligibleRateFeed(
	supabase: SupabaseClient,
	limit = 20
): Promise<LatestEligibleRateFeedPayload> {
	const { data, error } = await supabase.rpc('get_latest_rate_feed_state', { p_limit: limit });

	if (error) {
		console.error('[feed] get_latest_rate_feed_state failed:', error);
		throw new Error('Failed to load latest eligible feed');
	}

	const rows = (data ?? []) as LatestRateFeedStateRow[];
	const head = rows[0];
	const requestId = stringOrNull(head?.latest_completed_request_id) ?? '';
	const bookRows = rows.filter((row) => row.id != null);

	return {
		status: requestId ? 'completed' : 'none',
		books: mapEligibleFeedRows(bookRows),
		request_id: requestId,
		latest_request_id: stringOrNull(head?.latest_request_id),
		latest_request_status: head?.latest_request_status?.trim() || null,
		error_message: null
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
