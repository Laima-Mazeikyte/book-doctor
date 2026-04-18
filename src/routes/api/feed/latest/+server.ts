import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildFeedPayloadForRequest } from '$lib/server/feedPayload';
import { createSupabaseWithAuth } from '$lib/server/supabase';

type LatestFeedMode = 'cache_current' | 'cache_pending_newer' | 'newer_completed' | 'cold_start';

export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
	if (!accessToken) {
		throw error(401, 'Unauthorized');
	}

	const knownRequestId = url.searchParams.get('known_request_id')?.trim() || null;
	const supabase = createSupabaseWithAuth(accessToken);

	const [latestRequestResult, latestCompletedResult] = await Promise.all([
		supabase
			.from('feed_requests')
			.select('id, status')
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle(),
		supabase
			.from('feed_requests')
			.select('id')
			.eq('status', 'completed')
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle()
	]);

	if (latestRequestResult.error || latestCompletedResult.error) {
		console.error(latestRequestResult.error ?? latestCompletedResult.error);
		throw error(500, 'Failed to load feed requests');
	}

	const latestRequestId = latestRequestResult.data?.id != null ? String(latestRequestResult.data.id) : null;
	const latestRequestStatus = latestRequestResult.data?.status ?? null;
	const latestCompletedRequestId =
		latestCompletedResult.data?.id != null ? String(latestCompletedResult.data.id) : null;

	if (!latestCompletedRequestId) {
		return json({
			mode: 'cold_start' satisfies LatestFeedMode,
			latest_request_id: latestRequestId,
			latest_request_status: latestRequestStatus,
			latest_completed_request_id: null,
			latest_completed: null,
			status: 'none',
			books: [],
			request_id: null,
			error_message: null
		});
	}

	if (knownRequestId && latestCompletedRequestId === knownRequestId) {
		const mode =
			latestRequestId != null && latestRequestId !== knownRequestId && latestRequestStatus !== 'completed'
				? ('cache_pending_newer' satisfies LatestFeedMode)
				: ('cache_current' satisfies LatestFeedMode);

		return json({
			mode,
			latest_request_id: latestRequestId,
			latest_request_status: latestRequestStatus,
			latest_completed_request_id: latestCompletedRequestId,
			latest_completed: null,
			status: 'completed',
			books: [],
			request_id: latestCompletedRequestId,
			error_message: null
		});
	}

	try {
		const payload = await buildFeedPayloadForRequest(supabase, latestCompletedRequestId);
		return json({
			mode: 'newer_completed' satisfies LatestFeedMode,
			latest_request_id: latestRequestId,
			latest_request_status: latestRequestStatus,
			latest_completed_request_id: latestCompletedRequestId,
			latest_completed: payload,
			...payload
		});
	} catch (e) {
		console.error(e);
		throw error(500, 'Failed to load latest feed');
	}
};
