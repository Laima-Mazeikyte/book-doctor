import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FEED_REQUEST_BATCH_SIZE } from '$lib/feed/constants';
import { loadLatestEligibleRateFeed } from '$lib/server/feedPayload';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ request, url }) => {
	const accessToken = requireAccessToken(request);
	const limitParam = url.searchParams.get('limit');
	const limit = limitParam
		? Math.max(1, Number.parseInt(limitParam, 10) || FEED_REQUEST_BATCH_SIZE)
		: FEED_REQUEST_BATCH_SIZE;
	const supabase = createSupabaseWithAuth(accessToken);

	try {
		const payload = await loadLatestEligibleRateFeed(supabase, limit);
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
		console.error(e);
		throw error(500, 'Failed to load latest feed');
	}
};
