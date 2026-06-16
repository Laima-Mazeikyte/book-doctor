import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchBooksByUlidsInOrder } from '$lib/server/catalogBooks';
import { filterBookIdsExcludingUserLists } from '$lib/server/recommendationFilters';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url, request }) => {
	const requestId = url.searchParams.get('request_id')?.trim() ?? null;
	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken);

	let targetRequestId: string | null = requestId;

	if (!targetRequestId) {
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

	let bookIds = items.map((i) => String(i.book_id ?? '').trim()).filter(Boolean);

	bookIds = await filterBookIdsExcludingUserLists(supabase, bookIds, {
		excludeNotInterested: !requestId,
		excludeRated: true
	});
	if (bookIds.length === 0) {
		return json({ books: [], request_id: targetRequestId });
	}

	try {
		const fetchedBooks = await fetchBooksByUlidsInOrder(supabase, bookIds);
		const byBookId = new Map(fetchedBooks.map((book) => [book.book_id, book]));
		const books = items
			.map((item) => {
				const id = String(item.book_id ?? '').trim();
				return id ? (byBookId.get(id) ?? null) : null;
			})
			.filter((book): book is NonNullable<typeof book> => book != null);
		return json({ books, request_id: targetRequestId });
	} catch (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load books');
	}
};
