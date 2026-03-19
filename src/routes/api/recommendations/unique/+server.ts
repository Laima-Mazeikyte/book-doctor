import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ')
		? authHeader.slice(7)
		: null;
	const supabase = createSupabaseWithAuth(accessToken);

	// Get user's recommendation runs (request_ids) from recommendation_log
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
		return json({ books: [] });
	}

	// Get all items for those runs (may contain duplicates across runs)
	const { data: items, error: itemsError } = await supabase
		.from('recommendation_items')
		.select('book_id')
		.in('request_id', requestIds);

	if (itemsError) {
		console.error(itemsError);
		throw error(500, 'Failed to load recommendation items');
	}

	let uniqueBookIds = [...new Set(
		(items ?? [])
			.map((i) => parseInt(i.book_id, 10))
			.filter((id) => !Number.isNaN(id))
	)];

	// Exclude not-interested when authenticated
	if (accessToken && uniqueBookIds.length > 0) {
		const { data: notInterestedRows } = await supabase
			.from('user_not_interested')
			.select('book_id');
		const notInterestedSet = new Set(
			(notInterestedRows ?? []).map((r) => r.book_id).filter((id): id is number => Number.isInteger(id))
		);
		uniqueBookIds = uniqueBookIds.filter((id) => !notInterestedSet.has(id));
	}

	// Exclude rated books when authenticated
	if (accessToken && uniqueBookIds.length > 0) {
		const { data: ratedRows } = await supabase
			.from('user_ratings')
			.select('book_id');
		const ratedSet = new Set(
			(ratedRows ?? []).map((r) => r.book_id).filter((id): id is number => Number.isInteger(id))
		);
		uniqueBookIds = uniqueBookIds.filter((id) => !ratedSet.has(id));
	}

	if (uniqueBookIds.length === 0) {
		return json({ books: [] });
	}

	const base = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');
	const { data: booksData, error: booksError } = await supabase
		.from('books')
		.select('id, book_id, book_name, author, cover_url, summary, year')
		.in('book_id', uniqueBookIds);

	if (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load books');
	}

	const books = (booksData ?? []).map((b) => ({
		id: String(b.id),
		book_id: b.book_id,
		title: b.book_name,
		author: b.author,
		coverUrl: b.cover_url ?? (base ? `${base}/${b.book_id}.avif` : undefined),
		summary: b.summary ?? undefined,
		year: b.year != null ? String(b.year) : undefined
	}));

	// Sort by title for consistent list
	books.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));

	return json({ books });
};
