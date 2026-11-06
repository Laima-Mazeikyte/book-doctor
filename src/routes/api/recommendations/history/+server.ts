import { withRequestTimeout } from '$lib/server/requestTimeout';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';
import { loadRecentOverallRecommendationLogs } from '$lib/server/overallRecommendationLogs';

export const GET: RequestHandler = withRequestTimeout(async ({ request }, signal) => {
	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken, signal);

	const { logs, publicIds } = await loadRecentOverallRecommendationLogs(supabase).catch((cause) => {
		console.error(cause);
		throw error(500, 'Failed to load recommendation history');
	});

	const runs = logs.map((row) => ({
		request_id: row.request_id ? (publicIds.get(row.request_id) ?? row.request_id) : null,
		created_at: row.created_at ?? ''
	}));

	return json({ runs });
});
