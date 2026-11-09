import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseSelectionRequest, SELECTION_TYPES } from '$lib/recommendations/bookSelection';
import { isPublicRequestId } from '$lib/requests/publicId';
import { getUserIdFromToken } from '$lib/server/auth';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';
import { withRequestTimeout } from '$lib/server/requestTimeout';
import { fetchBooksByUlidsInOrder } from '$lib/server/catalogBooks';

const SELECT =
	'public_id, request_type, book_ids, status, result_count, error_code, skipped_book_ids, created_at';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

export const POST: RequestHandler = withRequestTimeout(async ({ request }, signal) => {
	const token = requireAccessToken(request);
	let body;
	try {
		body = parseSelectionRequest(await request.json());
	} catch (cause) {
		throw error(400, cause instanceof Error ? cause.message : 'Invalid selection.');
	}
	const userId = await getUserIdFromToken(token, signal);
	if (!userId) throw error(401, 'Sign in to get recommendations.');
	const db = createSupabaseWithAuth(token, signal);
	const { data, error: insertError } = await db
		.from('recommendation_requests')
		.insert({ user_id: userId, ...body })
		.select('public_id')
		.single();
	if (insertError || !data?.public_id) {
		console.error('[selection] Request insert failed', insertError?.code);
		if (
			insertError &&
			['42703', 'PGRST204', '23514', '23503', '42501', 'P0001'].includes(insertError.code)
		) {
			return json(
				{
					not_started: true,
					message: ['42703', 'PGRST204'].includes(insertError.code)
						? 'Book selection recommendations are not available yet. Your selection has been saved.'
						: 'This selection could not be submitted. Review your books and try again.'
				},
				{
					status: ['42703', 'PGRST204'].includes(insertError.code) ? 503 : 400,
					headers: privateHeaders
				}
			);
		}
		// A failed response can follow a committed insert; callers must recover before resubmitting.
		return json(
			{
				message:
					'Could not confirm whether the request started. Check recent requests before trying again.'
			},
			{ status: 502, headers: privateHeaders }
		);
	}
	return json({ request_id: data.public_id }, { status: 201, headers: privateHeaders });
});

export const GET: RequestHandler = withRequestTimeout(async ({ request, url }, signal) => {
	const token = requireAccessToken(request);
	const db = createSupabaseWithAuth(token, signal);
	const requestId = url.searchParams.get('request_id');
	if (!requestId) {
		const { data, error: readError } = await db
			.from('recommendation_requests')
			.select(SELECT)
			.in('request_type', [...SELECTION_TYPES])
			.order('created_at', { ascending: false })
			.limit(20);
		if (readError) throw error(503, 'Could not load recent selections.');
		return json({ requests: data ?? [] }, { headers: privateHeaders });
	}
	if (!isPublicRequestId(requestId)) throw error(400, 'Invalid request address.');
	const { data, error: readError } = await db
		.from('recommendation_requests')
		.select(SELECT)
		.eq('public_id', requestId)
		.in('request_type', [...SELECTION_TYPES])
		.maybeSingle();
	if (readError) throw error(503, 'Could not load this selection.');
	if (!data) throw error(404, 'This selection is unavailable.');
	// Polls need only request metadata; display records are loaded once on restoration.
	const books =
		url.searchParams.get('include_books') === '1'
			? await fetchBooksByUlidsInOrder(db, data.book_ids ?? [])
			: undefined;
	return json({ request: data, ...(books ? { books } : {}) }, { headers: privateHeaders });
});
