import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadLatestEligibleRateFeed } from '$lib/server/feedPayload';
import { createSupabaseWithAuth } from '$lib/server/supabase';

const DEFAULT_FEED_LIMIT = 20;

export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
	if (!accessToken) {
		throw error(401, 'Unauthorized');
	}

	const limitParam = url.searchParams.get('limit');
	const limit = limitParam
		? Math.max(1, Number.parseInt(limitParam, 10) || DEFAULT_FEED_LIMIT)
		: DEFAULT_FEED_LIMIT;
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
			ratings_count: payload.ratings_count
		});
	} catch (e) {
		console.error(e);
		throw error(500, 'Failed to load latest feed');
	}
};
