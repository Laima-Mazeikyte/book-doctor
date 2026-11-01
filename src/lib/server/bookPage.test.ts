import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '$lib/types/book';
import { createClient } from '@supabase/supabase-js';

const fixture = vi.hoisted(() => ({
	rpc: vi.fn()
}));
vi.mock('$lib/server/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import { load } from '../../routes/books/[slug]/+page.server';

const book: Book = {
	id: 'uuid',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	slug: 'the-test-book-an-author',
	title: 'The Test Book',
	author: 'An Author'
};
function event(path = `/books/${book.slug}`) {
	return {
		params: { slug: path.split('/')[2] },
		url: new URL(path, 'https://unread.example')
	} as Parameters<typeof load>[0];
}

beforeEach(() => {
	vi.resetAllMocks();
	fixture.rpc.mockResolvedValue({
		data: {
			book: {
				id: book.id,
				book_id: book.book_id,
				slug: book.slug,
				book_name: book.title,
				author: book.author,
				pace_value: 0.8
			},
			series: null
		},
		error: null
	});
});

describe('public book page loading', () => {
	it('retains the catalog public address and uses its slug for the lookup', async () => {
		await expect(load(event())).resolves.toMatchObject({
			canonicalUrl: `https://unread.example/books/${book.slug}`
		});
		expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('get_book_detail_with_series', {
			p_slug: book.slug
		});
	});
	it('returns 404 for malformed and absent books, and 503 for catalog outages', async () => {
		await expect(load(event('/books/invalid_slug'))).rejects.toMatchObject({ status: 404 });
		expect(fixture.rpc).not.toHaveBeenCalled();
		fixture.rpc.mockResolvedValue({ data: null, error: null });
		await expect(load(event())).rejects.toMatchObject({ status: 404 });
		fixture.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
		fixture.rpc.mockRejectedValue(new Error('Connection lost'));
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
	});
	it('loads book metadata and series members in a single request without ranking-derived membership', async () => {
		const reads: URL[] = [];
		const client = createClient('https://book-page.test', 'public-test-key', {
			db: { retry: false },
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
			global: {
				fetch: async (input) => {
					const url = new URL(input instanceof Request ? input.url : String(input));
					reads.push(url);
					// An author query never completes; it must not gate opening the book.
					if (url.searchParams.has('author')) return new Promise(() => {});
					return Response.json({
						book: {
							id: book.id,
							book_id: book.book_id,
							slug: book.slug,
							book_name: book.title,
							author: book.author,
							pace_value: 0.8,
							atmosphere_value: 0.2,
							entry_barrier_value: 0.8,
							book_ranking: null
						},
						series: {
							title: 'Example Series (An Author)',
							number: 1.5,
							members: [{ book_id: book.book_id, slug: book.slug, title: book.title, number: 1.5 }]
						}
					});
				}
			}
		});
		fixture.rpc.mockImplementation((name: string, args: Record<string, unknown>) =>
			client.rpc(name, args)
		);
		await expect(load(event())).resolves.toMatchObject({
			book: {
				...book,
				characteristics: [{ label: 'Introspective' }, { label: 'Cozy' }, { label: 'Specialized' }]
			},
			canonicalUrl: `https://unread.example/books/${book.slug}`,
			series: {
				title: 'Example Series (An Author)',
				number: 1.5,
				members: [{ book_id: book.book_id, slug: book.slug, title: book.title, number: 1.5 }]
			}
		});
		expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('get_book_detail_with_series', {
			p_slug: book.slug
		});
		expect(reads).toHaveLength(1);
		expect(reads[0].pathname).toBe('/rest/v1/rpc/get_book_detail_with_series');
	});
	it('keeps the book available without inventing membership from a ranking tooltip', async () => {
		const result = (await load(event())) as { series: unknown };
		expect(result.series).toBeNull();
	});
});
