import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '$lib/types/book';
import { createClient } from '@supabase/supabase-js';

const fixture = vi.hoisted(() => ({
	from: vi.fn(),
	query: {
		select: vi.fn(),
		eq: vi.fn(),
		neq: vi.fn(),
		order: vi.fn(),
		maybeSingle: vi.fn(),
		limit: vi.fn()
	}
}));
vi.mock('$lib/server/supabase', () => ({ supabase: { from: fixture.from } }));
import { load } from '../../routes/books/[book_id]/[[slug]]/+page.server';

const book: Book = {
	id: 'uuid',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	title: 'The Test Book',
	author: 'An Author'
};
function event(path = `/books/${book.book_id}/the-test-book`) {
	return {
		params: { book_id: path.split('/')[2], slug: path.split('/')[3] },
		url: new URL(path, 'https://unread.example')
	} as Parameters<typeof load>[0];
}

beforeEach(() => {
	vi.resetAllMocks();
	fixture.from.mockReturnValue(fixture.query);
	for (const key of ['select', 'eq', 'neq', 'order'] as const)
		fixture.query[key].mockReturnValue(fixture.query);
	fixture.query.limit.mockResolvedValue({ data: [], error: null });
	fixture.query.maybeSingle.mockResolvedValue({
		data: {
			id: book.id,
			book_id: book.book_id,
			book_name: book.title,
			author: book.author,
			pace_value: 0.8
		},
		error: null
	});
});

describe('public book page loading', () => {
	it('redirects missing, outdated, and lowercase identity URLs to the canonical URL', async () => {
		for (const path of [
			`/books/${book.book_id}`,
			`/books/${book.book_id}/old-title?source=share`,
			`/books/${book.book_id.toLowerCase()}/the-test-book`
		]) {
			await expect(load(event(path))).rejects.toMatchObject({
				status: 308,
				location: `/books/${book.book_id}/the-test-book${path.includes('?') ? '?source=share' : ''}`
			});
		}
		expect(fixture.from).toHaveBeenCalledTimes(3);
		expect(fixture.query.limit).not.toHaveBeenCalled();
	});
	it('returns 404 for malformed and absent books, and 503 for catalog outages', async () => {
		await expect(load(event('/books/invalid/title'))).rejects.toMatchObject({ status: 404 });
		expect(fixture.from).not.toHaveBeenCalled();
		fixture.query.maybeSingle.mockResolvedValue({ data: null, error: null });
		await expect(load(event())).rejects.toMatchObject({ status: 404 });
		fixture.query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
		fixture.query.maybeSingle.mockRejectedValue(new Error('Connection lost'));
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
	});
	it('loads the book and characteristics together without waiting for other books by the author', async () => {
		const reads: URL[] = [];
		const client = createClient('https://book-page.test', 'public-test-key', {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
			global: {
				fetch: async (input) => {
					const url = new URL(input instanceof Request ? input.url : String(input));
					reads.push(url);
					// An author query never completes; it must not gate opening the book.
					if (url.searchParams.has('author')) return new Promise(() => {});
					return Response.json({
						id: book.id,
						book_id: book.book_id,
						book_name: book.title,
						author: book.author,
						pace_value: 0.8
					});
				}
			}
		});
		fixture.from.mockImplementation((table: string) => client.from(table));
		await expect(load(event())).resolves.toMatchObject({
			book,
			characteristics: { labels: [{ label: 'Unhurried' }], availableDimensions: 1 },
			canonicalUrl: `https://unread.example/books/${book.book_id}/the-test-book`
		});
		expect(fixture.from).toHaveBeenCalledTimes(1);
		expect(reads).toHaveLength(1);
		expect(reads[0].searchParams.get('select')).toContain('book_name');
		expect(reads[0].searchParams.get('select')).toContain('pace_value');
		expect(reads[0].searchParams.get('book_id')).toBe(`eq.${book.book_id}`);
	});
});
