import {
	BOOK_GENRE_TYPE_SELECT,
	catalogTypeFromRow,
	genresFromGenreColumns,
	type BookGenreSlotRow
} from '$lib/book-catalog-fields';
import { coverUrlForBookId } from '$lib/book-cover';
import type { SupabaseClient } from '@supabase/supabase-js';

export type FeedBookPayload = {
	id: string;
	book_id: string;
	title: string;
	author: string;
	coverUrl?: string;
	summary?: string;
	year?: string;
	genres?: string[];
	type?: string;
};

export type FeedJsonResponse = {
	status: string;
	books: FeedBookPayload[];
	request_id: string;
	error_message: string | null;
};

/**
 * Build feed JSON for a single feed_requests.id (same behavior as GET /api/feed?request_id=).
 */
export async function buildFeedPayloadForRequest(
	supabase: SupabaseClient,
	requestId: string
): Promise<FeedJsonResponse> {
	const { data: feedReq, error: reqError } = await supabase
		.from('feed_requests')
		.select('status, error_message')
		.eq('id', requestId)
		.maybeSingle();

	if (reqError) {
		throw new Error('Failed to load feed request');
	}

	if (!feedReq) {
		throw new Error('Feed request not found');
	}

	const status = feedReq.status as string;
	const errorMessage = feedReq.error_message ?? null;

	if (status === 'failed' || status === 'skipped') {
		return {
			status,
			books: [],
			request_id: requestId,
			error_message: errorMessage
		};
	}

	if (status !== 'completed') {
		return {
			status,
			books: [],
			request_id: requestId,
			error_message: errorMessage
		};
	}

	const { data: items, error: itemsError } = await supabase
		.from('feed_items')
		.select('book_id, rank')
		.eq('request_id', requestId)
		.order('rank', { ascending: true });

	if (itemsError) {
		throw new Error('Failed to load feed items');
	}

	if (!items?.length) {
		return {
			status: 'completed',
			books: [],
			request_id: requestId,
			error_message: errorMessage
		};
	}

	let bookIds = items
		.map((i) => String(i.book_id ?? '').trim())
		.filter((id) => id.length > 0);

	if (bookIds.length > 0) {
		const { data: notInterestedRows } = await supabase
			.from('user_not_interested')
			.select('book_id');
		const notInterestedSet = new Set(
			(notInterestedRows ?? []).map((r) => r.book_id).filter((id): id is string => typeof id === 'string')
		);
		bookIds = bookIds.filter((id) => !notInterestedSet.has(id));
	}

	if (bookIds.length > 0) {
		const { data: ratedRows } = await supabase.from('user_ratings').select('book_id');
		const ratedSet = new Set(
			(ratedRows ?? []).map((r) => r.book_id).filter((id): id is string => typeof id === 'string')
		);
		bookIds = bookIds.filter((id) => !ratedSet.has(id));
	}

	if (bookIds.length === 0) {
		return {
			status: 'completed',
			books: [],
			request_id: requestId,
			error_message: errorMessage
		};
	}

	const { data: booksData, error: booksError } = await supabase
		.from('books')
		.select(`id, book_id, book_name, author, summary, year, ${BOOK_GENRE_TYPE_SELECT}`)
		.in('book_id', bookIds);

	if (booksError) {
		throw new Error('Failed to load books');
	}

	const byBookId = new Map(
		(booksData ?? []).map((b) => {
			const row = b as typeof b & BookGenreSlotRow & { type?: string | null };
			const type = catalogTypeFromRow(row);
			return [
				b.book_id,
				{
					id: String(b.id),
					book_id: b.book_id,
					title: b.book_name ?? '',
					author: b.author,
					coverUrl: coverUrlForBookId(b.book_id),
					summary: b.summary ?? undefined,
					year: b.year != null ? String(b.year) : undefined,
					genres: genresFromGenreColumns(row),
					...(type ? { type } : {})
				}
			] as const;
		})
	);

	const books = items
		.map((i) => {
			const id = String(i.book_id ?? '').trim();
			return id ? byBookId.get(id) ?? null : null;
		})
		.filter((b): b is NonNullable<typeof b> => b != null);

	return {
		status: 'completed',
		books,
		request_id: requestId,
		error_message: errorMessage
	};
}
