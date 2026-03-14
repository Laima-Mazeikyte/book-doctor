import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';
import { supabase } from '$lib/server/supabase';

const PAGE_SIZE = 24;

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	const offsetParam = url.searchParams.get('offset');
	const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

	if (!query) {
		return json({ books: [], nextOffset: 0, hasMore: false });
	}

	const base = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');

	const { data, error: dbError } = await supabase
		.from('books')
		.select('id, book_id, book_name, author, cover_url, summary, year')
		.or(`book_name.ilike.%${query}%,author.ilike.%${query}%`)
		.order('book_name', { ascending: true })
		.range(offset, offset + PAGE_SIZE - 1);

	if (dbError) {
		console.error(dbError);
		throw error(500, 'Failed to search books');
	}

	const books =
		data?.map((b) => ({
			id: String(b.id),
			book_id: b.book_id,
			title: b.book_name,
			author: b.author,
			coverUrl: b.cover_url ?? (base ? `${base}/${b.book_id}.jpg` : undefined),
			summary: b.summary ?? undefined,
			year: b.year ? String(b.year) : undefined
		})) ?? [];

	const hasMore = books.length === PAGE_SIZE;
	const nextOffset = offset + books.length;

	return json({ books, nextOffset, hasMore });
};
