import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BOOK_GENRE_TYPE_SELECT, catalogTypeFromRow, genresFromGenreColumns, type BookGenreSlotRow } from '$lib/book-catalog-fields';
import { coverUrlForBookId } from '$lib/book-cover';
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

	const { data: booksData, error: booksError } = await supabase
		.from('books')
		.select(`id, book_id, book_name, author, summary, year, ${BOOK_GENRE_TYPE_SELECT}`)
		.in('book_id', orderedBookIds);

	if (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load books');
	}

	const bookById = new Map(
		(booksData ?? []).map((b) => {
			const row = b as typeof b & BookGenreSlotRow & { type?: string | null };
			const type = catalogTypeFromRow(row);
			return [
				b.book_id,
				{
					id: String(b.id),
					book_id: b.book_id,
					title: b.book_name ?? '',
					author: b.author ?? '',
					coverUrl: coverUrlForBookId(b.book_id),
					summary: b.summary ?? undefined,
					year: b.year != null ? String(b.year) : undefined,
					genres: genresFromGenreColumns(row),
					...(type ? { type } : {})
				}
			] as const;
		})
	);

	const books = orderedBookIds
		.map((bookId) => bookById.get(bookId))
		.filter((b): b is NonNullable<typeof b> => b != null);

	return json({ books });
};
