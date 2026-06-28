import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildFeedPayloadForRequest } from '$lib/server/feedPayload';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url, request }) => {
	const requestId = url.searchParams.get('request_id')?.trim() ?? null;
	if (!requestId) {
		throw error(400, 'request_id is required');
	}

	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken);

	try {
		const payload = await buildFeedPayloadForRequest(supabase, requestId);
		return json(payload);
	} catch (e) {
		const msg = e instanceof Error ? e.message : '';
		if (msg === 'Feed request not found') {
			throw error(404, msg);
		}
		console.error(e);
		throw error(500, 'Failed to load feed');
	}
};
