import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadLatestEligibleRateFeed } from '$lib/server/feedPayload';
import { createSupabaseWithAuth } from '$lib/server/supabase';

type LatestFeedMode = 'newer_completed' | 'cold_start' | 'exhausted';

const DEFAULT_FEED_LIMIT = 20;

export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
	if (!accessToken) {
		throw error(401, 'Unauthorized');
	}

	const limitParam = url.searchParams.get('limit');
	const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || DEFAULT_FEED_LIMIT) : DEFAULT_FEED_LIMIT;
	const supabase = createSupabaseWithAuth(accessToken);

	try {
		const payload = await loadLatestEligibleRateFeed(supabase, limit);
		const requestId = payload.request_id || null;
		const feedMeta = {
			latest_request_id: payload.latest_request_id,
			latest_request_status: payload.latest_request_status
		};

		if (!requestId) {
			return json({
				mode: 'cold_start' satisfies LatestFeedMode,
				books: [],
				request_id: null,
				status: 'none',
				error_message: null,
				...feedMeta
			});
		}

		if (payload.books.length === 0) {
			return json({
				mode: 'exhausted' satisfies LatestFeedMode,
				books: [],
				request_id: requestId,
				status: payload.status,
				error_message: payload.error_message,
				...feedMeta
			});
		}

		return json({
			mode: 'newer_completed' satisfies LatestFeedMode,
			books: payload.books,
			request_id: requestId,
			status: payload.status,
			error_message: payload.error_message,
			...feedMeta
		});
	} catch (e) {
		console.error(e);
		throw error(500, 'Failed to load latest feed');
	}
};
