import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { GET } from '../../routes/api/books/by-author/+server';

const fixture = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$lib/server/supabase', () => ({
	get supabase() {
		return fixture.client;
	}
}));

const bookId = '01KR2ADTNG29NSQV23VAGV8FXB';
let reads: URL[];
let failure: boolean;
let count: number;
function event(query = `author=${encodeURIComponent('An Author')}&exclude=${bookId}`) {
	return { url: new URL(`http://localhost/api/books/by-author?${query}`) } as Parameters<
		typeof GET
	>[0];
}

beforeEach(() => {
	reads = [];
	failure = false;
	count = 49;
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
						id: `uuid-${index}`,
						book_id: `book-${index}`,
						book_name: `Book ${index}`,
						author: 'An Author'
					}))
				);
			}
		}
	});
});
afterEach(() => vi.restoreAllMocks());

it('loads up to 48 other books chronologically with unknown years last and reports truncation', async () => {
	const response = await GET(event());
	const payload = await response.json();
	expect(response.status).toBe(200);
	expect(payload.books).toHaveLength(48);
	expect(payload.books[0]).toMatchObject({ title: 'Book 0', author: 'An Author' });
	expect(payload.truncated).toBe(true);
	expect(reads).toHaveLength(1);
	expect(reads[0].searchParams.get('author')).toBe('eq.An Author');
	expect(reads[0].searchParams.get('book_id')).toBe(`neq.${bookId}`);
	expect(reads[0].searchParams.get('order')).toBe('year.asc.nullslast,book_name.asc,book_id.asc');
	expect(reads[0].searchParams.get('limit')).toBe('49');
});

it('returns a successful empty list when this is the author’s only catalog book', async () => {
	count = 0;
	expect(await (await GET(event())).json()).toEqual({ books: [], truncated: false });
});

it('propagates lookup failures for a retry instead of reporting no other books', async () => {
	failure = true;
	vi.spyOn(console, 'error').mockImplementation(() => {});
	await expect(GET(event())).rejects.toMatchObject({ status: 503 });
});

it.each([
	'',
	'author=An+Author&exclude=invalid',
	`exclude=${bookId}`,
	`author=${'a'.repeat(501)}&exclude=${bookId}`
])('rejects invalid author lookup input before querying: %s', async (query) => {
	await expect(GET(event(query))).rejects.toMatchObject({ status: 400 });
	expect(reads).toHaveLength(0);
});
