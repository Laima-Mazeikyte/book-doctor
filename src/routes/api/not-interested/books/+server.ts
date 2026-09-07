import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchBooksByUlidsInOrder } from '$lib/server/catalogBooks';
import { decodeNotInterestedCursor, encodeNotInterestedCursor } from '$lib/notInterested/cursor';
import type {
	NotInterestedCursor,
	NotInterestedOrder,
	NotInterestedPage
} from '$lib/notInterested/types';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';
import type { Book } from '$lib/types/book';

const PAGE_SIZE = 50;

function parseOrder(value: string | null): NotInterestedOrder {
	if (value === null || value === '') return 'newest';
	if (value === 'newest' || value === 'oldest') return value;
	throw error(400, 'Invalid order');
}

function rowBookId(row: { book_id?: unknown }): string | null {
	if (typeof row.book_id === 'string' && row.book_id.trim() !== '') return row.book_id;
	if (typeof row.book_id === 'number' && Number.isFinite(row.book_id)) return String(row.book_id);
	return null;
}

function rowCreatedAt(row: { created_at?: unknown }): string {
	if (typeof row.created_at !== 'string' || row.created_at.trim() === '') {
		throw error(500, 'Failed to load not interested');
	}
	return row.created_at;
}

function cursorFilter(cursor: NotInterestedCursor): string {
	const comparison = cursor.order === 'newest' ? 'lt' : 'gt';
	return `created_at.${comparison}.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},book_id.${comparison}.${cursor.bookId})`;
}

/** Returns one dismissal-ordered page of full book details for the current user. */
export const GET: RequestHandler = async ({ request, url }) => {
	const accessToken = requireAccessToken(request);
	const order = parseOrder(url.searchParams.get('order'));
	const cursorValue = url.searchParams.get('cursor');
	const cursor = cursorValue === null ? null : decodeNotInterestedCursor(cursorValue, order);
	const supabase = createSupabaseWithAuth(accessToken);

	let query = supabase.from('user_not_interested').select('book_id, created_at');
	if (cursor) query = query.or(cursorFilter(cursor));

	const { data: rows, error: selectError } = await query
		.order('created_at', { ascending: order === 'oldest' })
		.order('book_id', { ascending: order === 'oldest' })
		.limit(PAGE_SIZE + 1);

	if (selectError) {
		console.error(selectError);
		throw error(500, 'Failed to load not interested');
	}

	const dismissalRows = (rows ?? []) as Array<{ book_id?: unknown; created_at?: unknown }>;
	const pageRows = dismissalRows.slice(0, PAGE_SIZE);
	const hasNextPage = dismissalRows.length > PAGE_SIZE;
	const orderedBookIds = pageRows.map(rowBookId).filter((id): id is string => id !== null);

	let books: Book[] = [];
	if (orderedBookIds.length > 0) {
		try {
			// Missing catalog rows are skipped by the helper, but the cursor is based on dismissal
			// rows so a missing book cannot trap the next page.
			books = await fetchBooksByUlidsInOrder(supabase, orderedBookIds);
		} catch (booksError) {
			console.error(booksError);
			throw error(500, 'Failed to load books');
		}
	}

	let nextCursor: string | null = null;
	if (hasNextPage && pageRows.length > 0) {
		const lastRow = pageRows[pageRows.length - 1];
		const bookId = rowBookId(lastRow);
		if (!bookId) throw error(500, 'Failed to load not interested');
		nextCursor = encodeNotInterestedCursor({
			version: 1,
			order,
			createdAt: rowCreatedAt(lastRow),
			bookId
		});
	}

	return json({ books, nextCursor } satisfies NotInterestedPage);
};
