import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';
import { supabase, createSupabaseWithAuth } from '$lib/server/supabase';

const PAGE_SIZE = 20;
const TOP_100_SIZE = 100;

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

function mapRowToBook(b: {
	id: string;
	book_id: number;
	book_name: string | null;
	author: string;
	cover_url: string | null;
	summary: string | null;
	year: number | null;
	genres?: string[] | null;
}) {
	const base = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');
	return {
		id: String(b.id),
		book_id: b.book_id,
		title: b.book_name ?? '',
		author: b.author,
		coverUrl: b.cover_url ?? (base ? `${base}/${b.book_id}.avif` : undefined),
		summary: b.summary ?? undefined,
		year: b.year != null ? String(b.year) : undefined,
		genres: b.genres?.length ? b.genres : undefined
	};
}

export const GET: RequestHandler = async ({ url, request }) => {
	const offsetParam = url.searchParams.get('offset');
	const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
	const seedParam = url.searchParams.get('seed'); // session seed so order is stable for this visit but different each time
	const excludeParam = url.searchParams.get('exclude'); // comma-separated book_ids (for batch 6+)
	const excludeIds = excludeParam
		? excludeParam
				.split(',')
				.map((s) => parseInt(s.trim(), 10))
				.filter((n) => !Number.isNaN(n))
		: [];

	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
	let ratedSet = new Set<number>();
	if (accessToken) {
		const supabaseAuth = createSupabaseWithAuth(accessToken);
		const { data: ratedRows } = await supabaseAuth.from('user_ratings').select('book_id');
		ratedSet = new Set(
			(ratedRows ?? []).map((r) => r.book_id).filter((id): id is number => Number.isInteger(id))
		);
	}

	// Batches 1–5 (offset 0–80): 2 per genre per batch; which 2 from each genre is randomised per session
	if (offset < TOP_100_SIZE) {
		const { data: rows, error: dbError } = await supabase
			.from('top_100_books')
			.select(
				'book_id, genre, display_order, books(id, book_id, book_name, author, cover_url, summary, year, genres)'
			)
			.order('display_order', { ascending: true });

		if (dbError) {
			console.error(dbError);
			throw error(500, 'Failed to load books');
		}

		type BookRow = {
			id: string;
			book_id: number;
			book_name: string | null;
			author: string;
			cover_url: string | null;
			summary: string | null;
			year: number | null;
			genres?: string[] | null;
		};
		type Row = { genre: string; books: BookRow | null };
		const withGenre = (rows ?? []).map((row) => row as unknown as Row).filter((r) => r.books != null) as { genre: string; books: BookRow }[];

		// Group by genre (stable order)
		const genreOrder = [...new Set(withGenre.map((r) => r.genre))].sort();
		const byGenre: BookRow[][] = genreOrder.map((g) => []);
		for (const r of withGenre) {
			const i = genreOrder.indexOf(r.genre);
			if (i >= 0) byGenre[i].push(r.books);
		}

		const seed = seedParam && seedParam.length > 0 ? seedParam : crypto.randomUUID();
		// Shuffle within each genre so which 2 books go to batch 1, 2, … is random per session
		const shuffledByGenre = byGenre.map((arr, i) => shuffleWithSeed(arr, `${seed}:${genreOrder[i]}`));

		// Build list: 2 per genre per batch → positions 0–19 = round 0, 20–39 = round 1, …
		const ordered: BookRow[] = [];
		for (let round = 0; round < 5; round++) {
			for (let g = 0; g < genreOrder.length; g++) {
				ordered.push(shuffledByGenre[g][round * 2], shuffledByGenre[g][round * 2 + 1]);
			}
		}

		const page = ordered.slice(offset, offset + PAGE_SIZE);
		let books = page.map((b) => mapRowToBook(b));
		if (ratedSet.size > 0) {
			books = books.filter((b) => !ratedSet.has(b.book_id));
		}

		const nextOffset = offset + books.length;
		const hasMore = nextOffset < TOP_100_SIZE || nextOffset === TOP_100_SIZE;

		const payload: { books: ReturnType<typeof mapRowToBook>[]; nextOffset: number; hasMore: boolean; seed?: string } = {
			books,
			nextOffset,
			hasMore
		};
		if (!seedParam || seedParam.length === 0) payload.seed = seed;
		return json(payload);
	}

	// Batch 6+: from books, exclude top 100 + exclude param, prefer covers then random
	// Use RPC to avoid PostgREST URL length limit when excluding 100+ IDs
	const { data: top100Rows } = await supabase.from('top_100_books').select('book_id');
	const top100Ids = (top100Rows ?? []).map((r) => r.book_id);
	const excludeSet = new Set([...top100Ids, ...excludeIds]);
	const excludeArr = Array.from(excludeSet);

	const candidateLimit = Math.max(PAGE_SIZE * 3, 60);
	const { data: candidates, error: restError } = await supabase.rpc('get_books_excluding_ids', {
		p_exclude_ids: excludeArr.length > 0 ? excludeArr : null,
		p_limit_count: candidateLimit
	});

	if (restError) {
		console.error(restError);
		throw error(500, 'Failed to load books');
	}

	// Partition by cover, shuffle each group, then take PAGE_SIZE (prefer books with covers)
	const list = [...(candidates ?? [])];
	const hasCover = list.filter((b) => (b.cover_url ?? '').trim() !== '');
	const noCover = list.filter((b) => (b.cover_url ?? '').trim() === '');
	const seedStr = seedParam && seedParam.length > 0 ? `${seedParam}:rest:${offset}` : null;
	const shuffleOne = <T>(arr: T[], suffix: string): T[] => {
		const out = [...arr];
		if (seedStr) return shuffleWithSeed(out, `${seedStr}:${suffix}`);
		for (let i = out.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[out[i], out[j]] = [out[j], out[i]];
		}
		return out;
	};
	const shuffledHas = shuffleOne(hasCover, 'cover');
	const shuffledNo = shuffleOne(noCover, 'nocover');
	let books = [...shuffledHas, ...shuffledNo].slice(0, PAGE_SIZE).map((b) => mapRowToBook(b));
	if (ratedSet.size > 0) {
		books = books.filter((b) => !ratedSet.has(b.book_id));
	}

	const hasMore = books.length === PAGE_SIZE;
	const nextOffset = offset + books.length;

	return json({ books, nextOffset, hasMore });
};
