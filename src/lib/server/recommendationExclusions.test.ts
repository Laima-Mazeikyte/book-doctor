import { createClient } from '@supabase/supabase-js';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getRun } from '../../routes/api/recommendations/+server';
import { GET as getUnique } from '../../routes/api/recommendations/unique/+server';

const fixture = vi.hoisted(() => ({ createWithAuth: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ createSupabaseWithAuth: fixture.createWithAuth }));

let failedTable: string | null;
let reads: string[];
const ids = ['eligible', 'rated', 'dismissed'];

const fetcher: typeof fetch = async (input) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	const table = url.pathname.split('/').at(-1)!;
	reads.push(table);
	if (table === failedTable) {
		return Response.json(
			{ code: '57014', message: 'Internal database timeout details' },
			{ status: 500 }
		);
	}
	switch (table) {
		case 'recommendation_log':
			return Response.json([{ id: 1, request_id: '1', created_at: '2026-10-24T00:00:00Z' }]);
		case 'recommendation_requests':
			return Response.json(
				url.searchParams.has('id') && url.searchParams.get('id') === 'eq.1'
					? { id: '1' }
					: [{ id: '1', filters: null }]
			);
		case 'recommendation_items':
			return Response.json(
				ids.map((book_id, index) => ({ book_id, request_id: '1', rank: index + 1 }))
			);
		case 'user_ratings':
			return Response.json([{ book_id: 'rated' }]);
		case 'user_not_interested':
			return Response.json([{ book_id: 'dismissed' }]);
		case 'books':
			return Response.json(
				ids
					.filter((id) => url.searchParams.get('book_id')?.includes(id))
					.map((book_id) => ({
						id: `uuid-${book_id}`,
						book_id,
						book_name: book_id,
						author: 'Author'
					}))
			);
		default:
			throw new Error(`Unexpected table: ${table}`);
	}
};

function event<R extends '/api/recommendations' | '/api/recommendations/unique'>(
	path: R,
	query = ''
) {
	return {
		url: new URL(path + query, 'http://localhost'),
		request: new Request('http://localhost' + path + query, {
			headers: { Authorization: 'Bearer test-token' }
		})
	} as RequestEvent<Record<string, never>, R>;
}

describe('recommendation exclusion read failures', () => {
	beforeEach(() => {
		failedTable = null;
		reads = [];
		vi.spyOn(console, 'error').mockImplementation(() => {});
		fixture.createWithAuth.mockReturnValue(
			createClient('https://exclusions.test', 'public-test-key', {
				db: { retry: false },
				auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
				global: { fetch: fetcher }
			})
		);
	});
	afterEach(() => vi.restoreAllMocks());

	it.each(['user_ratings', 'user_not_interested'])(
		'rejects latest and combined recommendations when %s cannot be read',
		async (table) => {
			failedTable = table;
			await expect(getRun(event('/api/recommendations'))).rejects.toMatchObject({
				status: 500,
				body: { message: 'Failed to load recommendations' }
			});
			await expect(getUnique(event('/api/recommendations/unique'))).rejects.toMatchObject({
				status: 500,
				body: { message: 'Failed to load recommendations' }
			});
			expect(reads).not.toContain('books');
		}
	);

	it('rejects an individual shortlist when ratings cannot be read', async () => {
		failedTable = 'user_ratings';
		await expect(getRun(event('/api/recommendations', '?request_id=1'))).rejects.toMatchObject({
			status: 500,
			body: { message: 'Failed to load recommendations' }
		});
		expect(reads).not.toContain('books');
	});

	it('filters successful reads without extra exclusion queries', async () => {
		const payload = await (await getUnique(event('/api/recommendations/unique'))).json();
		expect(payload.books.map((book: { book_id: string }) => book.book_id)).toEqual(['eligible']);
		expect(reads.filter((table) => table.startsWith('user_'))).toEqual([
			'user_not_interested',
			'user_ratings'
		]);
	});

	it('preserves the filtered run mode that intentionally includes rated and dismissed books', async () => {
		failedTable = 'user_ratings';
		const payload = await (
			await getRun(event('/api/recommendations', '?request_id=1&include_rated=1'))
		).json();
		expect(payload.books.map((book: { book_id: string }) => book.book_id)).toEqual(ids);
		expect(reads.filter((table) => table.startsWith('user_'))).toEqual([]);
	});
});
