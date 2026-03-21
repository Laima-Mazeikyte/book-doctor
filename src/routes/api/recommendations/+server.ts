import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url, request }) => {
	const requestId = url.searchParams.get('request_id')?.trim() ?? null;
	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ')
		? authHeader.slice(7)
		: null;
	const supabase = createSupabaseWithAuth(accessToken);

	let targetRequestId: string | null = requestId;

	if (!targetRequestId) {
		// Latest for user: get most recent recommendation_log
		const { data: logs, error: logError } = await supabase
			.from('recommendation_log')
			.select('request_id')
			.order('created_at', { ascending: false })
			.limit(1);

		if (logError) {
			console.error(logError);
			throw error(500, 'Failed to load recommendation');
		}
		targetRequestId = logs?.[0]?.request_id ?? null;
	}

	if (!targetRequestId) {
		return json({ books: [], request_id: null });
	}

	const { data: items, error: itemsError } = await supabase
		.from('recommendation_items')
		.select('book_id, rank')
		.eq('request_id', targetRequestId)
		.order('rank', { ascending: true });

	if (itemsError) {
		console.error(itemsError);
		throw error(500, 'Failed to load recommendation items');
	}

	if (!items?.length) {
		return json({ books: [], request_id: targetRequestId });
	}

	// Parse book_id to integer for lookup in books (books.book_id is integer)
	let bookIds = items
		.map((i) => parseInt(i.book_id, 10))
		.filter((id) => !Number.isNaN(id));

	// Exclude not-interested when authenticated and fetching "latest" (no request_id), so batch view can show all for undo
	if (accessToken && !requestId && bookIds.length > 0) {
		const { data: notInterestedRows } = await supabase
			.from('user_not_interested')
			.select('book_id');
		const notInterestedSet = new Set(
			(notInterestedRows ?? []).map((r) => r.book_id).filter((id): id is number => Number.isInteger(id))
		);
		bookIds = bookIds.filter((id) => !notInterestedSet.has(id));
	}

	// Exclude rated books when authenticated (both latest and single-run views)
	if (accessToken && bookIds.length > 0) {
		const { data: ratedRows } = await supabase
			.from('user_ratings')
			.select('book_id');
		const ratedSet = new Set(
			(ratedRows ?? []).map((r) => r.book_id).filter((id): id is number => Number.isInteger(id))
		);
		bookIds = bookIds.filter((id) => !ratedSet.has(id));
	}

	if (bookIds.length === 0) {
		return json({ books: [], request_id: targetRequestId });
	}

	const base = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');
	const { data: booksData, error: booksError } = await supabase
		.from('books')
		.select('id, book_id, book_name, author, cover_url, summary, year, genres')
		.in('book_id', bookIds);

	if (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load books');
	}

	const byBookId = new Map(
		(booksData ?? []).map((b) => [
			b.book_id,
			{
				id: String(b.id),
				book_id: b.book_id,
				title: b.book_name,
				author: b.author,
				coverUrl: b.cover_url ?? (base ? `${base}/${b.book_id}.avif` : undefined),
				summary: b.summary ?? undefined,
				year: b.year != null ? String(b.year) : undefined,
				genres: b.genres?.length ? b.genres : undefined
			}
		])
	);

	// Preserve order by rank
	const books = items
		.map((i) => {
			const id = parseInt(i.book_id, 10);
			return Number.isNaN(id) ? null : byBookId.get(id) ?? null;
		})
		.filter((b): b is NonNullable<typeof b> => b != null);

	return json({ books, request_id: targetRequestId });
};
