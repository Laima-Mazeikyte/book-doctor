import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ request }) => {
	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken);

	const { data: logs, error: logError } = await supabase
		.from('recommendation_log')
		.select('request_id, created_at')
		.order('created_at', { ascending: false });

	if (logError) {
		console.error(logError);
		throw error(500, 'Failed to load recommendation history');
	}

	const runs = (logs ?? []).map((row) => ({
		request_id: row.request_id,
		created_at: row.created_at ?? ''
	}));

	return json({ runs });
};
