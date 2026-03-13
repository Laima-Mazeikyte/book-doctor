import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';
import { supabase } from '$lib/server/supabase';

const INITIAL_BATCH = 30;
const SUBSEQUENT_BATCH = 20;

export const GET: RequestHandler = async ({ url }) => {
	const offsetParam = url.searchParams.get('offset');
	const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
	const maxResults = offset === 0 ? INITIAL_BATCH : SUBSEQUENT_BATCH;

	const base = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');

	const { data, error: dbError } = await supabase
		.from('books')
		.select('id, book_id, "book name", author, cover_url, summary, year')
		.order('"book name"', { ascending: true })
		.range(offset, offset + maxResults - 1);

	if (dbError) {
		console.error(dbError);
		throw error(500, 'Failed to load books');
	}

	const books =
		data?.map((b) => ({
			id: String(b.id),
			title: b['book name'],
			author: b.author,
			coverUrl: b.cover_url ?? (base ? `${base}/${b.book_id}.jpg` : undefined),
			summary: b.summary ?? undefined,
			year: b.year ? String(b.year) : undefined
		})) ?? [];

	return json({ books, nextOffset: offset + books.length });
};
