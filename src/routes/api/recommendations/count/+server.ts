import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ')
		? authHeader.slice(7)
		: null;
	if (!accessToken) {
		throw error(401, 'Missing Authorization');
	}

	const supabase = createSupabaseWithAuth(accessToken);

	const { data, error: countError } = await supabase.rpc('get_recommendations_unread_count');

	if (countError) {
		console.error('[api/recommendations/count]', countError);
		throw error(500, 'Failed to load recommendation count');
	}

	return json({ count: data ?? 0 });
};
