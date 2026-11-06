import { withRequestTimeout } from '$lib/server/requestTimeout';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchBooksByUlidsInOrder } from '$lib/server/catalogBooks';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';
import { readAllPages } from '$lib/supabase/pagination';
import {
	createUserLibraryDeleteHandler,
	createUserLibraryPostHandler
} from '$lib/server/userLibraryMutations';

export const GET: RequestHandler = withRequestTimeout(async ({ request }, signal) => {
	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken, signal);

	const { data: rows, error: selectError } = await readAllPages((from, to) =>
		supabase
			.from('user_bookmarks')
			.select('book_id, created_at')
			.order('created_at', { ascending: false })
			.order('book_id', { ascending: true })
			.range(from, to)
	);

	if (selectError) {
		console.error(selectError);
		throw error(500, 'Failed to load bookmarks');
	}

	const orderedBookIds = (rows ?? [])
		.map((r) => r.book_id)
		.filter((id): id is string => typeof id === 'string' && id.trim() !== '');

	if (orderedBookIds.length === 0) {
		return json({ books: [], bookIds: [] });
	}

	try {
		const books = await fetchBooksByUlidsInOrder(supabase, orderedBookIds);
		return json({ books, bookIds: books.map((b) => b.id) });
	} catch (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load bookmarked books');
	}
});

export const POST = createUserLibraryPostHandler('user_bookmarks', 'Failed to add bookmark');
export const DELETE = createUserLibraryDeleteHandler('user_bookmarks', 'Failed to remove bookmark');
