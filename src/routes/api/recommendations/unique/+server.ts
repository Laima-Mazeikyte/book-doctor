import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';
import { BOOK_GENRE_TYPE_SELECT, catalogTypeFromRow, genresFromGenreColumns, type BookGenreSlotRow } from '$lib/book-catalog-fields';
import { createSupabaseWithAuth } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ')
		? authHeader.slice(7)
		: null;
	const supabase = createSupabaseWithAuth(accessToken);

	// Get user's recommendation runs (newest first) for per-book recency ordering
	const { data: logs, error: logError } = await supabase
		.from('recommendation_log')
		.select('request_id, created_at')
		.order('created_at', { ascending: false });

	if (logError) {
		console.error(logError);
		throw error(500, 'Failed to load recommendation runs');
	}

	const requestIds = (logs ?? []).map((r) => r.request_id).filter(Boolean);
	if (requestIds.length === 0) {
		return json({ books: [], allRecommendedBookIds: [], lastRecommendedAt: {} });
	}

	// Get all items for those runs (may contain duplicates across runs)
	const { data: items, error: itemsError } = await supabase
		.from('recommendation_items')
		.select('book_id, request_id')
		.in('request_id', requestIds);

	if (itemsError) {
		console.error(itemsError);
		throw error(500, 'Failed to load recommendation items');
	}

	const itemsByRequestId = new Map<string, number[]>();
	for (const row of items ?? []) {
		const bid = parseInt(row.book_id, 10);
		if (Number.isNaN(bid) || !row.request_id) continue;
		const list = itemsByRequestId.get(row.request_id) ?? [];
		list.push(bid);
		itemsByRequestId.set(row.request_id, list);
	}

	let uniqueBookIds = [...new Set([...itemsByRequestId.values()].flat())];
	const allRecommendedBookIds = [...uniqueBookIds];

	// Most recent run that contained each book (logs are newest-first)
	const lastRecommendedMs = new Map<number, number>();
	for (const log of logs ?? []) {
		const rid = log.request_id;
		if (!rid) continue;
		const runBookIds = itemsByRequestId.get(rid) ?? [];
		const tsRaw = log.created_at ? new Date(log.created_at).getTime() : 0;
		const ts = Number.isFinite(tsRaw) ? tsRaw : 0;
		for (const bid of runBookIds) {
			if (!lastRecommendedMs.has(bid)) {
				lastRecommendedMs.set(bid, ts);
			}
		}
	}

	// Exclude not-interested when authenticated
	if (accessToken && uniqueBookIds.length > 0) {
		const { data: notInterestedRows } = await supabase
			.from('user_not_interested')
			.select('book_id');
		const notInterestedSet = new Set(
			(notInterestedRows ?? []).map((r) => r.book_id).filter((id): id is number => Number.isInteger(id))
		);
		uniqueBookIds = uniqueBookIds.filter((id) => !notInterestedSet.has(id));
	}

	// Exclude rated books when authenticated
	if (accessToken && uniqueBookIds.length > 0) {
		const { data: ratedRows } = await supabase
			.from('user_ratings')
			.select('book_id');
		const ratedSet = new Set(
			(ratedRows ?? []).map((r) => r.book_id).filter((id): id is number => Number.isInteger(id))
		);
		uniqueBookIds = uniqueBookIds.filter((id) => !ratedSet.has(id));
	}

	if (uniqueBookIds.length === 0) {
		const lastRecommendedAt: Record<string, number> = {};
		for (const [bid, ms] of lastRecommendedMs) {
			lastRecommendedAt[String(bid)] = ms;
		}
		return json({
			books: [],
			allRecommendedBookIds,
			lastRecommendedAt
		});
	}

	const base = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');
	const { data: booksData, error: booksError } = await supabase
		.from('books')
		.select(`id, book_id, book_name, author, cover_url, summary, year, ${BOOK_GENRE_TYPE_SELECT}`)
		.in('book_id', uniqueBookIds);

	if (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load books');
	}

	const books = (booksData ?? []).map((b) => {
		const row = b as typeof b & BookGenreSlotRow & { type?: string | null };
		const type = catalogTypeFromRow(row);
		return {
			id: String(b.id),
			book_id: b.book_id,
			title: b.book_name,
			author: b.author,
			coverUrl: b.cover_url ?? (base ? `${base}/${b.book_id}.avif` : undefined),
			summary: b.summary ?? undefined,
			year: b.year != null ? String(b.year) : undefined,
			genres: genresFromGenreColumns(row),
			...(type ? { type } : {})
		};
	});

	// Newest recommendation batch first; stable tie-break by title
	books.sort((a, b) => {
		const ta = lastRecommendedMs.get(a.book_id ?? 0) ?? 0;
		const tb = lastRecommendedMs.get(b.book_id ?? 0) ?? 0;
		if (tb !== ta) return tb - ta;
		return (a.title ?? '').localeCompare(b.title ?? '');
	});

	const lastRecommendedAt: Record<string, number> = {};
	for (const [bid, ms] of lastRecommendedMs) {
		lastRecommendedAt[String(bid)] = ms;
	}

	return json({
		books,
		allRecommendedBookIds,
		lastRecommendedAt
	});
};
