import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseServiceRole } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';

type WebhookPayload = {
	type: string;
	table?: string;
	schema?: string;
	record?: { id: number; user_id: string; created_at?: string };
	old_record: unknown;
};

export const POST: RequestHandler = async ({ request }) => {
	// Optional: verify webhook secret
	const webhookSecret = env.SUPABASE_WEBHOOK_SECRET;
	if (webhookSecret) {
		const received = request.headers.get('x-webhook-secret');
		if (received !== webhookSecret) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	let body: WebhookPayload;
	try {
		body = (await request.json()) as WebhookPayload;
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (body?.type !== 'INSERT' || body?.table !== 'recommendation_requests' || !body?.record) {
		return new Response(JSON.stringify({ error: 'Invalid webhook payload' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const requestId = String(body.record.id);
	const userId = body.record.user_id;

	const supabase = createSupabaseServiceRole();
	if (!supabase) {
		console.error('Webhook: SUPABASE_SERVICE_ROLE_KEY not set');
		return new Response(JSON.stringify({ error: 'Server configuration error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const start = Date.now();

	// Load user's ratings (service role bypasses RLS)
	const { data: ratings, error: ratingsError } = await supabase
		.from('user_ratings')
		.select('book_id, book_rating')
		.eq('user_id', userId);

	if (ratingsError) {
		console.error('Webhook: failed to load user_ratings', ratingsError);
		return new Response(JSON.stringify({ error: 'Failed to load ratings' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Call BookDoc recommendation API if configured; otherwise return empty list
	let bookIds: number[] = [];
	const bookdocUrl = env.BOOKDOC_RECOMMEND_URL;
	if (bookdocUrl && ratings && ratings.length >= 10) {
		try {
			const res = await fetch(bookdocUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					user_id: userId,
					ratings: (ratings ?? []).map((r) => ({ book_id: r.book_id, rating: r.book_rating }))
				})
			});
			if (res.ok) {
				const data = (await res.json()) as { book_ids?: number[] };
				bookIds = Array.isArray(data?.book_ids) ? data.book_ids.slice(0, 10) : [];
			}
		} catch (e) {
			console.error('Webhook: BookDoc API call failed', e);
		}
	}

	const latencyMs = Date.now() - start;

	// Write recommendation_log
	const { error: logError } = await supabase.from('recommendation_log').insert({
		request_id: requestId,
		user_id: userId,
		latency_ms: latencyMs,
		created_at: new Date().toISOString()
	});

	if (logError) {
		console.error('Webhook: failed to insert recommendation_log', logError);
		return new Response(JSON.stringify({ error: 'Failed to write log' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Write recommendation_items (book_id stored as text in table)
	const items = bookIds.map((bookId, i) => ({
		request_id: requestId,
		user_id: userId,
		book_id: String(bookId),
		rank: i + 1,
		created_at: new Date().toISOString()
	}));

	if (items.length > 0) {
		const { error: itemsError } = await supabase.from('recommendation_items').insert(items);
		if (itemsError) {
			console.error('Webhook: failed to insert recommendation_items', itemsError);
		}
	}

	return json({ ok: true, request_id: requestId, item_count: items.length });
};
