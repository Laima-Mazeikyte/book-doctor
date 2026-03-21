import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';
import { getUserIdFromToken } from '$lib/server/auth';
import { BOOK_GENRE_TYPE_SELECT, catalogTypeFromRow, genresFromGenreColumns, type BookGenreSlotRow } from '$lib/book-catalog-fields';
import { createSupabaseWithAuth } from '$lib/server/supabase';

function getAccessToken(request: Request): string | null {
	const authHeader = request.headers.get('Authorization');
	return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

export const GET: RequestHandler = async ({ request }) => {
	const accessToken = getAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken);

	const { data: rows, error: selectError } = await supabase
		.from('user_bookmarks')
		.select('book_id');

	if (selectError) {
		console.error(selectError);
		throw error(500, 'Failed to load bookmarks');
	}

	const bookIds = (rows ?? []).map((r) => r.book_id).filter((id): id is number => id != null);
	if (bookIds.length === 0) {
		return json({ books: [], bookIds: [] });
	}

	const base = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');
	const { data: booksData, error: booksError } = await supabase
		.from('books')
		.select(`id, book_id, book_name, author, cover_url, summary, year, ${BOOK_GENRE_TYPE_SELECT}`)
		.in('book_id', bookIds);

	if (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load bookmarked books');
	}

	const books = (booksData ?? []).map((b) => {
		const row = b as typeof b & BookGenreSlotRow & { type?: string | null };
		const type = catalogTypeFromRow(row);
		return {
			id: String(b.id),
			book_id: b.book_id,
			title: b.book_name ?? '',
			author: b.author ?? '',
			coverUrl: b.cover_url ?? (base ? `${base}/${b.book_id}.avif` : undefined),
			summary: b.summary ?? undefined,
			year: b.year != null ? String(b.year) : undefined,
			genres: genresFromGenreColumns(row),
			...(type ? { type } : {})
		};
	});

	return json({ books, bookIds: books.map((b) => b.id) });
};

export const POST: RequestHandler = async ({ request }) => {
	const accessToken = getAccessToken(request);
	if (!accessToken) throw error(401, 'Missing Authorization');

	const userId = await getUserIdFromToken(accessToken);
	if (!userId) throw error(401, 'Invalid or expired token');

	let body: { book_id?: number };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const bookId = body.book_id;
	if (typeof bookId !== 'number' || !Number.isInteger(bookId)) {
		throw error(400, 'Missing or invalid book_id');
	}

	const supabase = createSupabaseWithAuth(accessToken);
	const { error: insertError } = await supabase
		.from('user_bookmarks')
		.upsert({ user_id: userId, book_id: bookId }, { onConflict: 'user_id,book_id' });

	if (insertError) {
		console.error(insertError);
		throw error(500, 'Failed to add bookmark');
	}

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, url }) => {
	const accessToken = getAccessToken(request);
	if (!accessToken) throw error(401, 'Missing Authorization');

	const bookIdParam = url.searchParams.get('book_id');
	const bookId = bookIdParam ? parseInt(bookIdParam, 10) : NaN;
	if (!Number.isInteger(bookId)) {
		throw error(400, 'Missing or invalid book_id');
	}

	const supabase = createSupabaseWithAuth(accessToken);
	// RLS restricts delete to own rows (user_id = auth.uid())
	const { error: deleteError } = await supabase
		.from('user_bookmarks')
		.delete()
		.eq('book_id', bookId);

	if (deleteError) {
		console.error(deleteError);
		throw error(500, 'Failed to remove bookmark');
	}

	return json({ ok: true });
};
