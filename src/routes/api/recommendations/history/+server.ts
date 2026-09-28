import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';
import { overallRecommendationLogs } from '$lib/server/overallRecommendationLogs';

export const GET: RequestHandler = async ({ request }) => {
	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken);

	const { data: allLogs, error: logError } = await supabase
		.from('recommendation_log')
		.select('request_id, created_at')
		.order('created_at', { ascending: false });

	if (logError) {
		console.error(logError);
		throw error(500, 'Failed to load recommendation history');
	}
	let logs;
	try {
		logs = await overallRecommendationLogs(supabase, allLogs ?? []);
	} catch (requestError) {
		console.error(requestError);
		throw error(500, 'Failed to load recommendation requests');
	}

	const runs = (logs ?? []).map((row) => ({
		request_id: row.request_id,
		created_at: row.created_at ?? ''
	}));

	return json({ runs });
};
