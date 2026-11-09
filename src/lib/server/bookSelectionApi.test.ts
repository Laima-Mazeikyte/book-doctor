import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { POST, GET } from '../../routes/api/recommendations/selection/+server';

const mocks = vi.hoisted(() => ({ db: vi.fn(), auth: vi.fn(), books: vi.fn(), eligible: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ createSupabaseWithAuth: mocks.db }));
vi.mock('$lib/server/auth', () => ({ getUserIdFromToken: mocks.auth }));
vi.mock('$lib/server/catalogBooks', () => ({ fetchBooksByUlidsInOrder: mocks.books }));
vi.mock('$lib/server/recommendationFilters', () => ({
	filterBookIdsExcludingUserLists: mocks.eligible
}));
const book_ids = Array.from({ length: 4 }, (_, i) => `01${String(i).padStart(24, '0')}`);
const selection = { request_type: 'rank_selection', book_ids };
let writes: unknown[];
let urls: URL[];
let insertError: string | null;
const run = {
	public_id: 'ChooseA1',
	...selection,
	status: 'completed',
	result_count: 4,
	created_at: '2026-11-06T12:00:00Z'
};
function event(body?: unknown, query = '') {
	const url = new URL(`http://localhost/api/recommendations/selection${query}`);
	return {
		url,
		request: new Request(url, {
			method: body ? 'POST' : 'GET',
			headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
			...(body ? { body: JSON.stringify(body) } : {})
		})
	} as Parameters<typeof POST>[0];
}
describe('selection request API', () => {
	beforeEach(() => {
		writes = [];
		urls = [];
		insertError = null;
		vi.clearAllMocks();
		mocks.auth.mockResolvedValue('verified-user');
		mocks.books.mockImplementation(async (_db, ids: string[]) =>
			ids.map((book_id) => ({ id: book_id, book_id, title: book_id, author: 'Author' }))
		);
		mocks.eligible.mockImplementation(async (_db, ids) => ids);
		mocks.db.mockReturnValue(
			createClient('https://selection.test', 'public-key', {
				db: { retry: false },
				auth: { persistSession: false },
				global: {
					fetch: async (input, init) => {
						const url = new URL(String(input));
						urls.push(url);
						if (init?.method === 'POST') {
							writes.push(JSON.parse(String(init.body)));
							return insertError
								? Response.json({ code: insertError, message: 'DB rejected' }, { status: 400 })
								: Response.json({ public_id: 'ChooseA1' });
						}
						return Response.json(url.searchParams.has('public_id') ? run : [run]);
					}
				}
			})
		);
	});
	it('submits only the agreed contract with server-verified ownership', async () => {
		const response = await POST(event(selection));
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ request_id: 'ChooseA1' });
		expect(writes).toEqual([{ ...selection, user_id: 'verified-user' }]);
		expect(mocks.eligible).not.toHaveBeenCalled();
		expect(mocks.books).not.toHaveBeenCalled();
	});
	it('rejects an invalid payload before reading or writing the database', async () => {
		await expect(POST(event({ ...selection, user_id: 'attacker' }))).rejects.toMatchObject({
			status: 400
		});
		expect(writes).toHaveLength(0);
		expect(mocks.auth).not.toHaveBeenCalled();
	});
	it('rejects missing authentication', async () => {
		mocks.auth.mockResolvedValue(null);
		await expect(POST(event(selection))).rejects.toMatchObject({ status: 401 });
		expect(writes).toHaveLength(0);
	});
	it('accepts explicitly selected read or dismissed books', async () => {
		mocks.eligible.mockResolvedValue(book_ids.slice(1));
		expect((await POST(event(selection))).status).toBe(201);
		expect(mocks.eligible).not.toHaveBeenCalled();
	});
	it('allows read books as inspiration without modifying ratings or bookmarks', async () => {
		expect(
			(await POST(event({ ...selection, request_type: 'recommend_from_selection' }))).status
		).toBe(201);
		expect(mocks.eligible).not.toHaveBeenCalled();
		expect(urls.every((url) => url.pathname.endsWith('/recommendation_requests'))).toBe(true);
	});
	it('lets the backend skip unavailable catalog books', async () => {
		mocks.books.mockResolvedValue([]);
		expect((await POST(event(selection))).status).toBe(201);
		expect(mocks.books).not.toHaveBeenCalled();
	});
	it('marks trigger validation failures as definitive rejections', async () => {
		insertError = 'P0001';
		const response = await POST(event(selection));
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ not_started: true });
	});
	it('keeps an ambiguous insert outcome distinct from a definitive database rejection', async () => {
		insertError = 'FETCH_ERROR';
		expect((await POST(event(selection))).status).toBe(502);
		insertError = '42703';
		const response = await POST(event(selection));
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ not_started: true });
	});
	it('loads a saved selection by its public ID and restores its input books only when requested', async () => {
		const response = await GET(event(undefined, '?request_id=ChooseA1&include_books=1'));
		expect((await response.json()).books).toHaveLength(4);
		expect(urls[0].searchParams.get('public_id')).toBe('eq.ChooseA1');
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		mocks.books.mockClear();
		await GET(event(undefined, '?request_id=ChooseA1'));
		expect(mocks.books).not.toHaveBeenCalled();
	});
	it('lists recent selection modes and rejects an invalid public address', async () => {
		expect((await (await GET(event())).json()).requests).toHaveLength(1);
		expect(urls[0].searchParams.get('limit')).toBe('20');
		expect(urls[0].searchParams.get('request_type')).toContain('recommend_from_selection');
		await expect(GET(event(undefined, '?request_id=1'))).rejects.toMatchObject({ status: 400 });
	});
});
