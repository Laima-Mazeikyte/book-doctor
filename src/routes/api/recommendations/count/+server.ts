import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ')
		? authHeader.slice(7)
		: null;
	const supabase = createSupabaseWithAuth(accessToken);

	const { data: logs, error: logError } = await supabase
		.from('recommendation_log')
		.select('request_id')
		.order('created_at', { ascending: false });

	if (logError) {
		console.error(logError);
		throw error(500, 'Failed to load recommendation runs');
	}

	const requestIds = (logs ?? []).map((r) => r.request_id).filter(Boolean);
	if (requestIds.length === 0) {
		return json({ count: 0 });
	}

	const { data: items, error: itemsError } = await supabase
		.from('recommendation_items')
		.select('book_id')
		.in('request_id', requestIds);

	if (itemsError) {
		console.error(itemsError);
		throw error(500, 'Failed to load recommendation items');
	}

	let uniqueBookIds = new Set(
		(items ?? [])
			.map((i) => parseInt(i.book_id, 10))
			.filter((id) => !Number.isNaN(id))
	);

	// Exclude not-interested when authenticated
	if (accessToken) {
		const { data: notInterestedRows } = await supabase
			.from('user_not_interested')
			.select('book_id');
		const notInterestedSet = new Set(
			(notInterestedRows ?? []).map((r) => r.book_id).filter((id): id is number => Number.isInteger(id))
		);
		uniqueBookIds = new Set([...uniqueBookIds].filter((id) => !notInterestedSet.has(id)));
	}

	// Exclude rated books when authenticated
	if (accessToken && uniqueBookIds.size > 0) {
		const { data: ratedRows } = await supabase
			.from('user_ratings')
			.select('book_id');
		const ratedSet = new Set(
			(ratedRows ?? []).map((r) => r.book_id).filter((id): id is number => Number.isInteger(id))
		);
		uniqueBookIds = new Set([...uniqueBookIds].filter((id) => !ratedSet.has(id)));
	}

	return json({ count: uniqueBookIds.size });
};
