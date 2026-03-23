import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildFeedPayloadForRequest } from '$lib/server/feedPayload';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
	if (!accessToken) {
		throw error(401, 'Unauthorized');
	}

	const supabase = createSupabaseWithAuth(accessToken);

	const { data: latest, error: qError } = await supabase
		.from('feed_requests')
		.select('id')
		.eq('status', 'completed')
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (qError) {
		console.error(qError);
		throw error(500, 'Failed to load feed requests');
	}

	if (!latest?.id) {
		return json({
			status: 'none',
			books: [],
			request_id: null,
			error_message: null
		});
	}

	const requestId = String(latest.id);

	try {
		const payload = await buildFeedPayloadForRequest(supabase, requestId);
		return json(payload);
	} catch (e) {
		console.error(e);
		throw error(500, 'Failed to load latest feed');
	}
};
