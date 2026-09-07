import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { decodeNotInterestedCursor, encodeNotInterestedCursor } from '$lib/notInterested/cursor';

const fixture = vi.hoisted(() => ({
	rows: [] as Array<{ book_id: string; created_at: string }>,
	books: [] as Array<{ id: string; book_id: string; title: string; author: string }>,
	queries: [] as Array<{ or: string | null; limit: number; ascending: boolean[] }>,
	createWithAuth: vi.fn(),
	fetchBooks: vi.fn()
}));

vi.mock('$lib/server/supabase', () => ({ createSupabaseWithAuth: fixture.createWithAuth }));
vi.mock('$lib/server/catalogBooks', () => ({
	fetchBooksByUlidsInOrder: fixture.fetchBooks
}));

import { GET } from '../../routes/api/not-interested/books/+server';

function event(query = ''): RequestEvent<Record<string, never>, '/api/not-interested/books'> {
	return {
		url: new URL(`/api/not-interested/books${query}`, 'http://localhost'),
		request: new Request(`http://localhost/api/not-interested/books${query}`, {
			headers: { Authorization: 'Bearer fixture-token' }
		})
	} as RequestEvent<Record<string, never>, '/api/not-interested/books'>;
}

function makeRows(count: number, order: 'newest' | 'oldest' = 'newest') {
	return Array.from({ length: count }, (_, index) => ({
		book_id: `book-${order}-${index}`,
		created_at: '2026-09-07T12:00:00.123456Z'
	}));
}

beforeEach(() => {
	fixture.rows = [];
	fixture.books = [];
	fixture.queries = [];
	fixture.createWithAuth.mockClear();
	fixture.fetchBooks.mockReset();
	fixture.fetchBooks.mockImplementation(async (_supabase: unknown, ids: string[]) =>
		fixture.books.filter((book) => ids.includes(book.book_id))
	);
	fixture.createWithAuth.mockImplementation(() => ({
		from() {
			let orValue: string | null = null;
			let limitValue = 0;
			const ascending: boolean[] = [];
			const query = {
				select() {
					return query;
				},
				or(value: string) {
					orValue = value;
					return query;
				},
				order(_column: string, options: { ascending: boolean }) {
					ascending.push(options.ascending);
					return query;
				},
				limit(value: number) {
					limitValue = value;
					fixture.queries.push({ or: orValue, limit: limitValue, ascending });
					return query;
				},
				then(resolve: (value: unknown) => unknown) {
					return Promise.resolve({ data: fixture.rows, error: null }).then(resolve);
				}
			};
			return query;
		}
	}));
});

describe('not interested books endpoint', () => {
	it('uses exactly 50 rows and no next cursor when the collection ends at 50', async () => {
		fixture.rows = makeRows(50);
		fixture.books = fixture.rows.map((row) => ({
			id: `uuid-${row.book_id}`,
			book_id: row.book_id,
			title: row.book_id,
			author: ''
		}));

		const payload = await (await GET(event('?order=newest'))).json();

		expect(payload.nextCursor).toBeNull();
		expect(payload.books).toHaveLength(50);
		expect(fixture.queries[0]).toMatchObject({ limit: 51, ascending: [false, false] });
		expect(fixture.fetchBooks).toHaveBeenCalledWith(
			expect.anything(),
			fixture.rows.map((row) => row.book_id)
		);
	});

	it('advances from the 50th dismissal even when the 51st row has an equal timestamp', async () => {
		fixture.rows = makeRows(51);
		fixture.books = fixture.rows.slice(0, 50).map((row) => ({
			id: `uuid-${row.book_id}`,
			book_id: row.book_id,
			title: row.book_id,
			author: ''
		}));

		const payload = await (await GET(event('?order=newest'))).json();
		const cursor = decodeNotInterestedCursor(payload.nextCursor, 'newest');

		expect(cursor.createdAt).toBe(fixture.rows[49].created_at);
		expect(cursor.bookId).toBe(fixture.rows[49].book_id);
		expect(payload.books).toHaveLength(50);

		fixture.rows = makeRows(1);
		fixture.books = [];
		await GET(event(`?order=newest&cursor=${encodeURIComponent(payload.nextCursor)}`));
		expect(fixture.queries[1].or).toContain('created_at.lt.');
		expect(fixture.queries[1].or).toContain('book_id.lt.');
	});

	it('reverses ordering and comparisons for oldest-first', async () => {
		fixture.rows = makeRows(51, 'oldest');
		fixture.books = fixture.rows.slice(0, 50).map((row) => ({
			id: `uuid-${row.book_id}`,
			book_id: row.book_id,
			title: row.book_id,
			author: ''
		}));

		const payload = await (await GET(event('?order=oldest'))).json();
		const cursor = decodeNotInterestedCursor(payload.nextCursor, 'oldest');
		expect(cursor.order).toBe('oldest');
		expect(fixture.queries[0]).toMatchObject({ ascending: [true, true] });

		fixture.rows = makeRows(1, 'oldest');
		await GET(event(`?order=oldest&cursor=${encodeURIComponent(payload.nextCursor)}`));
		expect(fixture.queries[1].or).toContain('created_at.gt.');
		expect(fixture.queries[1].or).toContain('book_id.gt.');
	});

	it('rejects invalid and mismatched cursors before reading Supabase', async () => {
		const newest = encodeNotInterestedCursor({
			version: 1,
			order: 'newest',
			createdAt: '2026-09-07T12:00:00.123456Z',
			bookId: 'book-1'
		});

		await expect(
			GET(event('?order=oldest&cursor=' + encodeURIComponent(newest)))
		).rejects.toMatchObject({
			status: 400
		});
		expect(fixture.createWithAuth).not.toHaveBeenCalled();
	});
});
