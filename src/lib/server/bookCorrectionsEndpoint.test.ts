import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

const fixture = vi.hoisted(() => ({
	getUser: vi.fn(),
	rpc: vi.fn(),
	create: vi.fn(),
	from: vi.fn(),
	select: vi.fn(),
	eq: vi.fn(),
	maybeSingle: vi.fn()
}));
vi.mock('$lib/server/supabase', () => ({ createSupabaseWithAuth: fixture.create }));
vi.mock('$lib/book-cover', () => ({
	coverUrlForBookId: (id: string) => `https://covers.example/${id}-720.avif`
}));
import { GET, POST, DELETE } from '../../routes/api/book-corrections/+server';

const bookId = '01KR2ADTNG29NSQV23VAGV8FXB';
const id = '11111111-1111-4111-8111-111111111111';
function event(method: string, body?: unknown, token: string | null = 'token') {
	return {
		url: new URL(`http://localhost/api/book-corrections?book_id=${bookId}`),
		request: new Request('http://localhost/api/book-corrections', {
			method,
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			body: body === undefined ? undefined : JSON.stringify(body)
		})
	} as RequestEvent<Record<string, never>, '/api/book-corrections'>;
}

beforeEach(() => {
	vi.clearAllMocks();
	fixture.getUser.mockResolvedValue({ data: { user: { id, is_anonymous: false } }, error: null });
	fixture.create.mockReturnValue({
		auth: { getUser: fixture.getUser },
		rpc: fixture.rpc,
		from: fixture.from
	});
	fixture.from.mockReturnValue({ select: fixture.select });
	fixture.select.mockReturnValue({ eq: fixture.eq });
	fixture.eq.mockReturnValue({ maybeSingle: fixture.maybeSingle });
	fixture.maybeSingle.mockResolvedValue({ data: { year: 1965 }, error: null });
	fixture.rpc.mockResolvedValue({
		data: { catalog: { coverUrl: '', year: '1998' }, pending: [], remaining: 20, resetsAt: null },
		error: null
	});
});

describe('correction endpoints', () => {
	it('verifies registration for every operation before reading or writing proposals', async () => {
		await expect(GET(event('GET', undefined, null))).rejects.toMatchObject({ status: 401 });
		fixture.getUser.mockResolvedValue({ data: { user: { id, is_anonymous: true } }, error: null });
		await expect(GET(event('GET'))).rejects.toMatchObject({ status: 403 });
		await expect(
			POST(event('POST', { book_id: bookId, id, changes: { title: 'New title' } }))
		).rejects.toMatchObject({ status: 403 });
		await expect(DELETE(event('DELETE', { id }))).rejects.toMatchObject({ status: 403 });
		expect(fixture.rpc).not.toHaveBeenCalled();
	});
	it('returns private uncached context with the actual derived catalog cover', async () => {
		const response = await GET(event('GET'));
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect((await response.json()).catalog.coverUrl).toBe(
			`https://covers.example/${bookId}-720.avif`
		);
		expect(fixture.rpc).toHaveBeenCalledWith('get_book_correction_context', { p_book_id: bookId });
	});
	it.each([undefined, ''])(
		'loads the database year when the correction context returns %s',
		async (year) => {
			fixture.rpc.mockResolvedValue({
				data: {
					catalog: { coverUrl: '', year },
					pending: [{ original_values: { coverUrl: '' } }],
					remaining: 20,
					resetsAt: null
				},
				error: null
			});
			const response = await GET(event('GET'));
			const context = await response.json();
			expect(context.catalog.year).toBe('1965');
			expect(context.pending[0].original_values.year).toBe('1965');
			expect(fixture.from).toHaveBeenCalledWith('books');
			expect(fixture.select).toHaveBeenCalledWith('year');
			expect(fixture.eq).toHaveBeenCalledWith('book_id', bookId);
		}
	);
	it('keeps an unknown database year blank and preserves recorded proposal years', async () => {
		fixture.rpc.mockResolvedValue({
			data: {
				catalog: { coverUrl: '' },
				pending: [{ original_values: { year: '1900' } }, { original_values: { year: '' } }],
				remaining: 20,
				resetsAt: null
			},
			error: null
		});
		fixture.maybeSingle.mockResolvedValue({ data: { year: null }, error: null });
		const context = await (await GET(event('GET'))).json();
		expect(context.catalog.year).toBe('');
		expect(
			context.pending.map(
				(proposal: { original_values: { year: string } }) => proposal.original_values.year
			)
		).toEqual(['1900', '']);
	});
	it('saves only validated changes using the user-scoped atomic RPC', async () => {
		await POST(
			event('POST', {
				book_id: bookId,
				id,
				user_id: 'untrusted',
				changes: { title: ' Fixed title ' }
			})
		);
		expect(fixture.rpc).toHaveBeenCalledWith('save_book_correction', {
			p_book_id: bookId,
			p_id: id,
			p_changes: { title: 'Fixed title' }
		});
		await expect(
			POST(event('POST', { book_id: bookId, id, changes: { status: 'approved' } }))
		).rejects.toMatchObject({ status: 400 });
	});
	it('maps exhausted quota and closed proposals to actionable HTTP errors', async () => {
		fixture.rpc.mockResolvedValue({ data: null, error: { code: 'PT429' } });
		await expect(
			POST(event('POST', { book_id: bookId, id, changes: { title: 'New title' } }))
		).rejects.toMatchObject({ status: 429 });
		fixture.rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } });
		await expect(DELETE(event('DELETE', { id }))).rejects.toMatchObject({ status: 409 });
	});
	it('withdraws by proposal ID without accepting a caller-supplied owner', async () => {
		const response = await DELETE(event('DELETE', { id, user_id: 'someone-else' }));
		expect(response.status).toBe(204);
		expect(fixture.rpc).toHaveBeenCalledWith('withdraw_book_correction', { p_id: id });
	});
	it('rejects oversized fields and short new genres before contacting the database', async () => {
		for (const changes of [
			{ title: 'a'.repeat(201) },
			{ author: 'a'.repeat(201) },
			{ description: { category: 'factual', explanation: 'a'.repeat(601) } },
			{ description: { category: '', explanation: 'A problem' } },
			{ summary: 'Replacement descriptions are no longer accepted.' },
			{ title: 'New title', author: 'New author' },
			{ year: '2000.5' },
			{ year: '0' },
			{ coverUrl: 'https://images.example/' + 'a'.repeat(512) },
			{ genres: { add: ['SF'], remove: [] } }
		]) {
			await expect(POST(event('POST', { book_id: bookId, id, changes }))).rejects.toMatchObject({
				status: 400
			});
		}
		expect(fixture.rpc).not.toHaveBeenCalled();
	});
	it('accepts a publication year as an independent normalized correction', async () => {
		await POST(event('POST', { book_id: bookId, id, changes: { year: '0200' } }));
		expect(fixture.rpc).toHaveBeenCalledWith('save_book_correction', {
			p_book_id: bookId,
			p_id: id,
			p_changes: { year: '200' }
		});
	});
	it('records a description issue as one field with a category and explanation', async () => {
		await POST(
			event('POST', {
				book_id: bookId,
				id,
				changes: { description: { category: 'too_generic', explanation: ' Too vague. ' } }
			})
		);
		expect(fixture.rpc).toHaveBeenCalledWith('save_book_correction', {
			p_book_id: bookId,
			p_id: id,
			p_changes: { description: { category: 'too_generic', explanation: 'Too vague.' } }
		});
	});
});
