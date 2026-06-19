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

export type LatestEligibleRateFeedMode =
	| 'has_eligible_feed'
	| 'feed_exhausted'
	| 'feed_generation_pending'
	| 'no_feed_yet'
	| 'feed_error';

export type LatestEligibleRateFeedPayload = FeedJsonResponse & {
	mode: LatestEligibleRateFeedMode;
	latest_request_id: string | null;
	latest_request_status: string | null;
	latest_request_error_message: string | null;
	ratings_count: number;
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

type FeedRequestPointer = {
	id: number | string | null;
	status: string | null;
	error_message?: string | null;
};

function stringOrNull(value: number | string | null | undefined): string | null {
	if (value == null) return null;
	const s = String(value).trim();
	return s || null;
}

function mapEligibleFeedRows(rows: EligibleFeedBookRow[]): FeedBookPayload[] {
	return rows.map((row) => mapBookRowToBook(row));
}

function isTerminalFeedStatus(status: string | null | undefined): boolean {
	return status === 'completed' || status === 'failed' || status === 'skipped';
}

function normalizeFeedStatus(status: string | null | undefined): string | null {
	return status?.trim() || null;
}

export async function loadLatestEligibleRateFeed(
	supabase: SupabaseClient,
	limit = 20
): Promise<LatestEligibleRateFeedPayload> {
	const [latestAnyResult, latestCompletedResult, ratingsCountResult, latestStateResult] =
		await Promise.all([
			supabase
				.from('feed_requests')
				.select('id, status, error_message')
				.order('created_at', { ascending: false, nullsFirst: false })
				.limit(1)
				.maybeSingle(),
			supabase
				.from('feed_requests')
				.select('id, status, error_message')
				.eq('status', 'completed')
				.order('created_at', { ascending: false, nullsFirst: false })
				.limit(1)
				.maybeSingle(),
			supabase.from('user_ratings').select('book_id', { count: 'exact', head: true }),
			supabase.rpc('get_latest_rate_feed_state', { p_limit: limit })
		]);

	if (latestAnyResult.error) {
		console.error('[feed] latest feed request lookup failed:', latestAnyResult.error);
		throw new Error('Failed to load latest feed request');
	}

	if (latestCompletedResult.error) {
		console.error(
			'[feed] latest completed feed request lookup failed:',
			latestCompletedResult.error
		);
		throw new Error('Failed to load latest completed feed request');
	}

	if (ratingsCountResult.error) {
		console.error('[feed] user_ratings count failed:', ratingsCountResult.error);
		throw new Error('Failed to load ratings count');
	}

	if (latestStateResult.error) {
		console.error('[feed] get_latest_rate_feed_state failed:', latestStateResult.error);
		throw new Error('Failed to load latest eligible feed');
	}

	const latestAny = latestAnyResult.data as FeedRequestPointer | null;
	const latestCompleted = latestCompletedResult.data as FeedRequestPointer | null;
	const latestRequestId = stringOrNull(latestAny?.id);
	const latestRequestStatus = normalizeFeedStatus(latestAny?.status);
	const latestRequestErrorMessage = latestAny?.error_message?.trim() || null;
	const latestCompletedRequestId = stringOrNull(latestCompleted?.id);

	const rows = (latestStateResult.data ?? []) as LatestRateFeedStateRow[];
	const head = rows[0];
	const requestId =
		stringOrNull(head?.latest_completed_request_id) ?? latestCompletedRequestId ?? '';
	const bookRows = rows.filter((row) => row.id != null);
	const books = mapEligibleFeedRows(bookRows);
	const ratingsCount = ratingsCountResult.count ?? 0;

	let mode: LatestEligibleRateFeedMode;
	if (books.length > 0) {
		mode = 'has_eligible_feed';
	} else if (latestRequestId && !isTerminalFeedStatus(latestRequestStatus)) {
		mode = 'feed_generation_pending';
	} else if (latestRequestStatus === 'failed' || latestRequestStatus === 'skipped') {
		mode = 'feed_error';
	} else if (requestId) {
		mode = 'feed_exhausted';
	} else {
		mode = 'no_feed_yet';
	}

	return {
		mode,
		status: latestCompleted?.status ?? (requestId ? 'completed' : 'none'),
		books,
		request_id: requestId,
		latest_request_id: stringOrNull(head?.latest_request_id) ?? latestRequestId,
		latest_request_status: normalizeFeedStatus(head?.latest_request_status) ?? latestRequestStatus,
		latest_request_error_message: latestRequestErrorMessage,
		ratings_count: ratingsCount,
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
