import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FEED_REQUEST_BATCH_SIZE } from '$lib/feed/constants';
import { FeedAccessError, loadLatestEligibleRateFeed } from '$lib/server/feedPayload';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ request, url, setHeaders }) => {
	const started = performance.now();
	const timings: string[] = [];
	const recordTiming = (name: string, durationMs: number) => {
		timings.push(`${name};dur=${durationMs.toFixed(1)}`);
	};
	const accessToken = requireAccessToken(request);
	const limitParam = url.searchParams.get('limit');
	const limit = limitParam
		? Math.max(1, Number.parseInt(limitParam, 10) || FEED_REQUEST_BATCH_SIZE)
		: FEED_REQUEST_BATCH_SIZE;
	const supabase = createSupabaseWithAuth(accessToken);

	try {
		const payload = await loadLatestEligibleRateFeed(supabase, limit, recordTiming);
		const requestId = payload.request_id || null;
		return json({
			mode: payload.mode,
			books: payload.books,
			request_id: requestId,
			status: payload.status,
			error_message: payload.error_message,
			latest_request_id: payload.latest_request_id,
			latest_request_status: payload.latest_request_status,
			latest_request_error_message: payload.latest_request_error_message,
			ratings_count: payload.ratings_count,
			interaction_count: payload.interaction_count,
			eligible_for_feed: payload.eligible_for_feed
		});
	} catch (e) {
		if (e instanceof FeedAccessError) throw error(e.status, e.message);
		console.error(e);
		throw error(500, 'Failed to load latest feed');
	} finally {
		// feed_bootstrap includes the full Supabase round trip and response parsing.
		// feed_total also includes application mapping and response construction.
		recordTiming('feed_total', performance.now() - started);
		setHeaders({ 'Server-Timing': timings.join(', '), 'Cache-Control': 'private, no-store' });
	}
};
