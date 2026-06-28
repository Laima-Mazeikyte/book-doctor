import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ request }) => {
	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken);
	const { data, error: countError } = await supabase.rpc('get_recommendations_unread_count');

	if (countError) {
		console.error('[api/recommendations/count]', countError);
		throw error(500, 'Failed to load recommendation count');
	}

	return json({ count: data ?? 0 });
};
