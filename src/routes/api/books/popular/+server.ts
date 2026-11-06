import { withRequestTimeout } from '$lib/server/requestTimeout';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BOOK_CATALOG_SELECT } from '$lib/book-catalog-fields';
import type { BookCatalogRow } from '$lib/search/mapBookRowToBook';
import { mapBookRowToBook } from '$lib/search/mapBookRowToBook';
import { supabase, createSupabaseWithAuth } from '$lib/server/supabase';

const PAGE_SIZE = 20;

/** Seeded RNG (mulberry32) so the same seed gives the same order across requests. */
function createSeededRng(seedStr: string): () => number {
	let h = 0;
	for (let i = 0; i < seedStr.length; i++) {
		h = Math.imul(31, h) + seedStr.charCodeAt(i);
		h = (h << 13) | (h >>> 19);
		h = h >>> 0;
	}
	let s = h || 1;
	return () => {
		s = Math.imul(s, 0x6d2b79f5) >>> 0;
		const t = s;
		return (t ^ (t >>> 15)) >>> 0;
	};
}

function shuffleWithSeed<T>(arr: T[], seedStr: string): T[] {
	const rng = createSeededRng(seedStr);
	const out = [...arr];
	for (let i = out.length - 1; i > 0; i--) {
		const j = (rng() % (i + 1)) >>> 0;
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

type BookRow = BookCatalogRow;

type Top100CatalogRow = BookRow & {
	genre: string;
	display_order: number;
};

function mapRowToBook(b: BookRow) {
	return mapBookRowToBook(b);
}

async function loadTop100Catalog(
	accessToken: string | null,
	signal: AbortSignal
): Promise<Top100CatalogRow[]> {
	if (accessToken) {
		const supabaseAuth = createSupabaseWithAuth(accessToken, signal);
		const { data, error: rpcError } = await supabaseAuth
			.rpc('get_eligible_top_100_books_annotated')
			.abortSignal(signal);
		if (rpcError) {
			console.error('[popular] get_eligible_top_100_books_annotated failed:', rpcError);
			throw new Error('Failed to load books');
		}
		return (data ?? []) as Top100CatalogRow[];
	}

	const { data: rows, error: dbError } = await supabase
		.from('top_100_books')
		.select(`book_id, genre, display_order, books(${BOOK_CATALOG_SELECT})`)
		.order('display_order', { ascending: true })
		.abortSignal(signal);

	if (dbError) {
		console.error(dbError);
		throw error(500, 'Failed to load books');
	}

	type Row = { genre: string; display_order: number; books: BookRow | null };
	return (rows ?? [])
		.map((row) => row as unknown as Row)
		.filter((r) => r.books != null)
		.map((r) => ({
			...r.books!,
			genre: r.genre,
			display_order: r.display_order
		}));
}

function buildTop100Page(catalog: Top100CatalogRow[], offset: number, seedParam: string | null) {
	const genreOrder = [...new Set(catalog.map((r) => r.genre))].sort();
	const byGenre: BookRow[][] = genreOrder.map(() => []);
	for (const row of catalog) {
		const i = genreOrder.indexOf(row.genre);
		if (i >= 0) byGenre[i].push(row);
	}

	const seed = seedParam && seedParam.length > 0 ? seedParam : crypto.randomUUID();
	const shuffledByGenre = byGenre.map((arr, i) => shuffleWithSeed(arr, `${seed}:${genreOrder[i]}`));

	const ordered: BookRow[] = [];
	for (let round = 0; round < 5; round++) {
		for (let g = 0; g < genreOrder.length; g++) {
			for (const idx of [round * 2, round * 2 + 1]) {
				const row = shuffledByGenre[g][idx];
				if (row) ordered.push(row);
			}
		}
	}

	const page = ordered.slice(offset, offset + PAGE_SIZE);
	const books = page.map((b) => mapRowToBook(b));
	const nextOffset = offset + page.length;
	const hasMore = nextOffset < ordered.length;

	return {
		books,
		nextOffset,
		hasMore,
		seed: !seedParam || seedParam.length === 0 ? seed : undefined
	};
}

export const GET: RequestHandler = withRequestTimeout(async ({ url, request }, signal) => {
	const offsetParam = url.searchParams.get('offset');
	const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
	const seedParam = url.searchParams.get('seed');

	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

	const catalog = await loadTop100Catalog(accessToken, signal);
	const payload = buildTop100Page(catalog, offset, seedParam);
	return json(payload);
});
