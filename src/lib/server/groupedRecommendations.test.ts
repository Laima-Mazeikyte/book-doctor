import { beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { flavorFixture } from '$lib/recommendations/flavorGroups.fixture';
import { GET as getRun } from '../../routes/api/recommendations/+server';
import { GET as getCount } from '../../routes/api/recommendations/count/+server';
import { load as loadPage } from '../../routes/rate/recommendations/shortlist/+page';
import { authStore } from '$lib/stores/auth';
import type { Session } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ createSupabaseWithAuth: mocks.db }));
vi.mock('$app/environment', () => ({ browser: true }));
let row: Record<string, unknown>;
let tables: string[];
function event(path = '/api/recommendations?request_id=Grouped1') {
	const url = new URL(path, 'http://localhost');
	return {
		url,
		request: new Request(url, { headers: { Authorization: 'Bearer token' } })
	} as never;
}
beforeEach(() => {
	tables = [];
	row = {
		id: 1,
		public_id: 'Grouped1',
		request_type: null,
		filters: null,
		output_format: 'flavors_v1',
		status: 'completed',
		result_count: 10,
		flavor_groups: flavorFixture(
			Array.from({ length: 9 }, (_, i) => ({
				book_id: 'book-' + i,
				rank: i + 1,
				flavor_evidence:
					i === 8
						? {
								reference_book_id: 'reference',
								dimension: 'depth',
								reference_value: 0.4,
								candidate_value: 0.8
							}
						: undefined
			}))
		)
	};
	mocks.db.mockReturnValue(
		createClient('https://grouped.test', 'public-key', {
			db: { retry: false },
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
			global: {
				fetch: async (input) => {
					const url = new URL(input instanceof Request ? input.url : String(input));
					const table = url.pathname.split('/').at(-1)!;
					tables.push(table);
					if (table === 'recommendation_requests') return Response.json([row]);
					if (table === 'recommendation_items')
						throw new Error('Grouped results must not read legacy items');
					if (table === 'user_ratings') return Response.json([{ book_id: 'book-0' }]);
					if (table === 'user_not_interested') return Response.json([{ book_id: 'book-8' }]);
					if (table === 'books') {
						const ids = (url.searchParams.get('book_id') ?? '').slice(4, -1).split(',');
						return Response.json(
							ids.map((book_id) => ({ id: book_id, book_id, book_name: book_id, author: 'Author' }))
						);
					}
					throw new Error(table);
				}
			}
		})
	);
});
it('hydrates theme-only books, preserves comparative evidence, and keeps displayed count independent of result_count', async () => {
	const payload = await (await getRun(event())).json();
	expect(payload.books).toHaveLength(9);
	expect(payload.flavor_groups.groups).toHaveLength(10);
	expect(payload.flavor_groups.groups[1].items[1].flavor_evidence.candidate_value).toBe(0.8);
	expect(payload.flavorReferenceBooksById.reference.title).toBe('reference');
	expect(tables).not.toContain('recommendation_items');
});
it.each(['pending', 'processing', 'failed'])(
	'returns %s without attempting to hydrate books',
	async (status) => {
		row.status = status;
		row.error_code = status === 'failed' ? 'recommendation_failed' : null;
		row.flavor_groups = null;
		const payload = await (await getRun(event())).json();
		expect(payload.status).toBe(status);
		expect(payload.error_code).toBe(status === 'failed' ? 'recommendation_failed' : null);
		expect(payload.books).toEqual([]);
		expect(tables).not.toContain('books');
	}
);
it('accepts completed all-empty groups without pretending the run is pending', async () => {
	row.result_count = 0;
	row.flavor_groups = flavorFixture();
	const payload = await (await getRun(event())).json();
	expect(payload.status).toBe('completed');
	expect(payload.flavor_groups.groups).toHaveLength(10);
});
it('rejects legacy runs and malformed completed payloads', async () => {
	row.output_format = 'legacy';
	await expect(getRun(event())).rejects.toMatchObject({ status: 404 });
	row.output_format = 'flavors_v1';
	row.flavor_groups = null;
	await expect(getRun(event())).rejects.toMatchObject({ status: 500 });
});
it('counts grouped books once after rating and dismissal exclusions', async () => {
	const payload = await (await getCount(event('/api/recommendations/count'))).json();
	expect(payload.count).toBe(7);
});
it('turns an unsupported direct link into a route 404 after authentication', async () => {
	authStore.setSession({ access_token: 'token', user: { id: 'owner' } } as Session);
	const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
	await expect(
		loadPage({
			url: new URL('http://localhost/rate/recommendations/shortlist?request_id=Legacy01'),
			fetch
		} as never)
	).rejects.toMatchObject({ status: 404 });
	expect(fetch).toHaveBeenCalledOnce();
	authStore.setSession(null);
});
