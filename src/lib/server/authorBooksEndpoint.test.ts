import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { GET } from '../../routes/api/books/by-author/+server';

const fixture = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$lib/server/supabase', () => ({
	get supabase() {
		return fixture.client;
	}
}));

let reads: URL[];
let failure: boolean;
let count: number;
let rowPatch: Record<string, unknown>;
function event(query = `author=${encodeURIComponent('An Author')}`) {
	return { url: new URL(`http://localhost/api/books/by-author?${query}`) } as Parameters<
		typeof GET
	>[0];
}

beforeEach(() => {
	reads = [];
	failure = false;
	count = 49;
	rowPatch = {};
	fixture.client = createClient('https://author-books.test', 'public-test-key', {
		db: { retry: false },
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: {
			fetch: async (input) => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				reads.push(url);
				if (failure) return Response.json({ message: 'Database unavailable' }, { status: 500 });
				return Response.json(
					Array.from({ length: count }, (_, index) => ({
						book_id: `01${String(index).padStart(24, '0')}`,
						slug: `book-${index}`,
						title: `Book ${index}`,
						...rowPatch
					}))
				);
			}
		}
	});
});
afterEach(() => vi.restoreAllMocks());

it('loads 48 author books plus a truncation sentinel in chronological order without excluding a book', async () => {
	const response = await GET(event());
	const payload = await response.json();
	expect(response.status).toBe(200);
	expect(payload.books).toHaveLength(48);
	expect(payload.books[0]).toEqual({
		book_id: '01000000000000000000000000',
		slug: 'book-0',
		title: 'Book 0'
	});
	expect(payload.truncated).toBe(true);
	expect(reads).toHaveLength(1);
	expect(reads[0].searchParams.get('author')).toBe('eq.An Author');
	expect(reads[0].searchParams.get('select')).toBe('book_id,slug,title:book_name');
	expect(reads[0].searchParams.has('book_id')).toBe(false);
	expect(reads[0].searchParams.get('order')).toBe('year.asc.nullslast,book_name.asc,book_id.asc');
	expect(reads[0].searchParams.get('limit')).toBe('49');
});

it.each([1, 47, 48])(
	'returns the complete collection without truncation for %i author books',
	async (size) => {
		count = size;
		const payload = await (await GET(event())).json();
		expect(payload.books).toHaveLength(size);
		expect(payload.truncated).toBe(false);
	}
);

it('returns a successful empty collection when no author books are found', async () => {
	count = 0;
	expect(await (await GET(event())).json()).toEqual({ books: [], truncated: false });
});

it('keeps the response minimal even if an upstream row includes extra metadata', async () => {
	count = 1;
	rowPatch = {
		id: 'internal-uuid',
		author: 'An Author',
		summary: 'Unused synopsis',
		year: 2020,
		coverUrl: 'https://covers.example/book-720.avif',
		genres: ['Fantasy'],
		characteristics: [{ label: 'Deep' }],
		keywords: ['Magic'],
		distinctions: { book: null, author: null }
	};
	expect(await (await GET(event())).json()).toEqual({
		books: [{ book_id: '01000000000000000000000000', slug: 'book-0', title: 'Book 0' }],
		truncated: false
	});
});

it.each([
	{ book_id: null },
	{ book_id: '' },
	{ slug: null },
	{ slug: '   ' },
	{ title: null },
	{ title: '' }
])(
	'rejects malformed core identity rather than returning a partial author collection: %j',
	async (patch) => {
		count = 1;
		rowPatch = patch;
		await expect(GET(event())).rejects.toThrow('Invalid author-book catalog identity');
	}
);

it('propagates lookup failures for a retry instead of reporting no other books', async () => {
	failure = true;
	vi.spyOn(console, 'error').mockImplementation(() => {});
	await expect(GET(event())).rejects.toMatchObject({ status: 503 });
});

it.each(['', 'author=', 'author=+++', `author=${'a'.repeat(501)}`])(
	'rejects invalid author lookup input before querying: %s',
	async (query) => {
		await expect(GET(event(query))).rejects.toMatchObject({ status: 400 });
		expect(reads).toHaveLength(0);
	}
);
