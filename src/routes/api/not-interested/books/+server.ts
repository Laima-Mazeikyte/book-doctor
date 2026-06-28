import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchBooksByUlidsInOrder } from '$lib/server/catalogBooks';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';

/** Returns full book details for the current user's not-interested list. */
export const GET: RequestHandler = async ({ request }) => {
	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken);

	const { data: rows, error: selectError } = await supabase
		.from('user_not_interested')
		.select('book_id, created_at')
		.order('created_at', { ascending: false });

	if (selectError) {
		console.error(selectError);
		throw error(500, 'Failed to load not interested');
	}

	const orderedBookIds = (rows ?? [])
		.map((r) => r.book_id)
		.filter((id): id is string => typeof id === 'string' && id.trim() !== '');

	if (orderedBookIds.length === 0) {
		return json({ books: [] });
	}

	try {
		const books = await fetchBooksByUlidsInOrder(supabase, orderedBookIds);
		return json({ books });
	} catch (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load books');
	}
};
