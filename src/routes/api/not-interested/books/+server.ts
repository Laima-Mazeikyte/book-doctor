import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';
import { createSupabaseWithAuth } from '$lib/server/supabase';

function getAccessToken(request: Request): string | null {
	const authHeader = request.headers.get('Authorization');
	return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

/**
 * GET /api/not-interested/books
 * Returns full book details for the current user's not-interested list (for the tracking page).
 */
export const GET: RequestHandler = async ({ request }) => {
	const accessToken = getAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken);

	const { data: rows, error: selectError } = await supabase
		.from('user_not_interested')
		.select('book_id');

	if (selectError) {
		console.error(selectError);
		throw error(500, 'Failed to load not interested');
	}

	const bookIds = (rows ?? [])
		.map((r) => r.book_id)
		.filter((id): id is number => id != null && Number.isInteger(id));

	if (bookIds.length === 0) {
		return json({ books: [] });
	}

	const base = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');
	const { data: booksData, error: booksError } = await supabase
		.from('books')
		.select('id, book_id, book_name, author, cover_url, summary, year')
		.in('book_id', bookIds);

	if (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load books');
	}

	const books = (booksData ?? []).map((b) => ({
		id: String(b.id),
		book_id: b.book_id,
		title: b.book_name ?? '',
		author: b.author ?? '',
		coverUrl: b.cover_url ?? (base ? `${base}/${b.book_id}.avif` : undefined),
		summary: b.summary ?? undefined,
		year: b.year != null ? String(b.year) : undefined
	}));

	return json({ books });
};
