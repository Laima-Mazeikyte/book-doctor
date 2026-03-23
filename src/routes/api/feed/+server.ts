import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildFeedPayloadForRequest } from '$lib/server/feedPayload';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url, request }) => {
	const requestId = url.searchParams.get('request_id')?.trim() ?? null;
	if (!requestId) {
		throw error(400, 'request_id is required');
	}

	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
	if (!accessToken) {
		throw error(401, 'Unauthorized');
	}

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
