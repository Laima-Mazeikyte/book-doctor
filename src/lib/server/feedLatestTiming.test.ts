import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { isHttpError } from '@sveltejs/kit';
import { get } from 'svelte/store';
import { coverUrlForBookId } from '$lib/book-cover';
import { createRateFeedController, RateFeedReadError } from '$lib/feed/rateFeedController';
import { readLatestRateFeed } from '$lib/feed/rateFeedContext';
import type { BookCatalogRow } from '$lib/search/mapBookRowToBook';
import type { LatestEligibleRateFeedPayload } from './feedPayload';

const fixture = vi.hoisted(() => ({ createWithAuth: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ createSupabaseWithAuth: fixture.createWithAuth }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

import { GET } from '../../routes/api/feed/latest/+server';

const bookRow = {
	id: 'book-uuid',
	book_id: 'book-ulid',
	book_name: 'A book',
	author: 'An author',
	summary: 'A summary',
	year: 1984,
	genre1: ' Fiction ',
	genre2: 'Classics',
	genre3: 'Fiction',
	genre4: null,
	genre5: null,
	genre6: null,
	genre7: null,
	type: ' Novel ',
	rank: 1
};

type Bootstrap = Omit<LatestEligibleRateFeedPayload, 'books'> & {
	books: Array<BookCatalogRow & { rank: number }>;
};

function bootstrap(overrides: Partial<Bootstrap> = {}): Bootstrap {
	return {
		mode: 'has_eligible_feed',
		status: 'completed',
		request_id: '42',
		error_message: null,
		latest_request_id: '43',
		latest_request_status: 'processing',
		latest_request_error_message: null,
		ratings_count: 249,
		interaction_count: 1228,
		eligible_for_feed: true,
		books: [bookRow],
		...overrides
	};
}

function event(query = '', authorized = true) {
	const url = `http://localhost/api/feed/latest${query}`;
	return {
		url: new URL(url),
		request: new Request(url, {
			headers: authorized ? { Authorization: 'Bearer fixture-token' } : {}
		}),
		setHeaders: vi.fn()
	};
}

function setup(payload: unknown = bootstrap(), status = 200) {
	const calls: Array<{
		path: string;
		method: string;
		body: unknown;
		authorization: string | null;
	}> = [];
	fixture.createWithAuth.mockReturnValue(
		createClient('https://fixture.supabase.test', 'fixture-key', {
			db: { retry: false },
			accessToken: async () => 'fixture-token',
			global: {
				fetch: async (input, init) => {
					const request = new Request(input, init);
					calls.push({
						path: new URL(request.url).pathname,
						method: request.method,
						body: await request.json(),
						authorization: request.headers.get('Authorization')
					});
					await new Promise((resolve) => setTimeout(resolve, 400));
					return Response.json(payload, { status });
				}
			}
		})
	);
	return calls;
}

function timings(e: ReturnType<typeof event>) {
	const header = e.setHeaders.mock.calls[0][0]['Server-Timing'] as string;
	return Object.fromEntries(
		header.split(', ').map((part) => {
			const [name, duration] = part.split(';dur=');
			return [name, Number(duration)];
		})
	);
}

async function getResponse(e: ReturnType<typeof event>) {
	const response = GET(e as unknown as Parameters<typeof GET>[0]);
	await vi.runAllTimersAsync();
	return response;
}

async function getFailure(e: ReturnType<typeof event>) {
	const result = Promise.resolve(GET(e as unknown as Parameters<typeof GET>[0])).catch(
		(error) => error
	);
	await vi.runAllTimersAsync();
	return result;
}

beforeEach(() => {
	vi.useFakeTimers();
	fixture.createWithAuth.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('latest feed unified RPC', () => {
	it('uses one authenticated RPC and preserves the complete mapped JSON contract and timings', async () => {
		const calls = setup();
		const e = event();
		const response = await getResponse(e);

		expect(response.status).toBe(200);
		expect(e.setHeaders).toHaveBeenCalledWith(
			expect.objectContaining({ 'Cache-Control': 'private, no-store' })
		);
		expect(await response.json()).toEqual({
			mode: 'has_eligible_feed',
			status: 'completed',
			request_id: '42',
			error_message: null,
			latest_request_id: '43',
			latest_request_status: 'processing',
			latest_request_error_message: null,
			ratings_count: 249,
			interaction_count: 1228,
			eligible_for_feed: true,
			books: [
				{
					id: 'book-uuid',
					book_id: 'book-ulid',
					title: 'A book',
					author: 'An author',
					coverUrl: coverUrlForBookId('book-ulid'),
					summary: 'A summary',
					year: '1984',
					genres: ['Fiction', 'Classics'],
					type: 'Novel',
					qualityBand: null
				}
			]
		});
		expect(fixture.createWithAuth).toHaveBeenCalledExactlyOnceWith('fixture-token');
		expect(calls).toEqual([
			{
				path: '/rest/v1/rpc/get_rate_feed_bootstrap',
				method: 'POST',
				body: { p_limit: 50 },
				authorization: 'Bearer fixture-token'
			}
		]);
		expect(timings(e)).toEqual({ feed_bootstrap: 400, feed_total: 400 });
	});

	it.each([
		['?limit=1', 1],
		['?limit=100', 100],
		['?limit=-5', 1],
		['?limit=invalid', 50]
	])('preserves limit handling for %s', async (query, expectedLimit) => {
		const calls = setup();
		const response = await getResponse(event(query));

		expect(response.status).toBe(200);
		expect(calls).toHaveLength(1);
		expect(calls[0].body).toEqual({ p_limit: expectedLimit });
	});

	it.each<Partial<Bootstrap>>([
		{
			mode: 'below_threshold',
			status: 'none',
			request_id: '',
			latest_request_id: null,
			latest_request_status: null,
			ratings_count: 0,
			interaction_count: 0,
			eligible_for_feed: false
		},
		{ mode: 'feed_generation_pending', status: 'none', request_id: '' },
		{
			mode: 'feed_error',
			latest_request_status: 'failed',
			latest_request_error_message: 'Generation failed'
		},
		{
			mode: 'feed_error',
			latest_request_status: 'skipped',
			latest_request_error_message: 'Generation skipped'
		},
		{ mode: 'feed_exhausted', latest_request_status: 'completed' },
		{
			mode: 'no_feed_yet',
			status: 'none',
			request_id: '',
			latest_request_id: null,
			latest_request_status: null,
			ratings_count: 0,
			interaction_count: 1
		}
	])('preserves empty-feed mode $mode with status $latest_request_status', async (overrides) => {
		const payload = bootstrap({ ...overrides, books: [] });
		const calls = setup(payload);
		const e = event();
		const response = await getResponse(e);

		expect(await response.json()).toEqual({ ...payload, request_id: payload.request_id || null });
		expect(calls).toHaveLength(1);
		expect(timings(e)).toEqual({ feed_bootstrap: 400, feed_total: 400 });
	});

	it('preserves book order and nullable catalog fields through the existing mapper', async () => {
		setup(
			bootstrap({
				books: [
					{ ...bookRow, id: 'first-book', book_id: 'first-ulid', rank: 2 },
					{
						...bookRow,
						id: 'second-book',
						book_id: 'second-ulid',
						book_name: null,
						author: null,
						summary: null,
						year: null,
						rank: 1
					}
				]
			})
		);
		const response = await getResponse(event());
		const payload = await response.json();

		expect(payload.books.map((book: { id: string }) => book.id)).toEqual([
			'first-book',
			'second-book'
		]);
		expect(payload.books[1]).toMatchObject({ title: '', author: '' });
		expect(payload.books[1]).not.toHaveProperty('summary');
		expect(payload.books[1]).not.toHaveProperty('year');
	});

	it('returns the existing 500 response with timing when the RPC is unavailable, without legacy fallback', async () => {
		const calls = setup({ code: 'PGRST202', message: 'RPC unavailable' }, 400);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const e = event();

		expect(await getFailure(e)).toMatchObject({
			status: 500,
			body: { message: 'Failed to load latest feed' }
		});
		expect(calls).toHaveLength(1);
		expect(timings(e)).toEqual({ feed_bootstrap: 400, feed_total: 400 });
	});

	it.each([
		[401, 'PGRST301', 'Authentication required'],
		[403, '42501', 'Feed access denied']
	] as const)(
		'preserves Supabase HTTP %s and returns a safe message with timing',
		async (status, code, message) => {
			const calls = setup({ code, message: 'Private upstream error details' }, status);
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const e = event();

			expect(await getFailure(e)).toMatchObject({ status, body: { message } });
			expect(calls).toHaveLength(1);
			expect(timings(e)).toEqual({ feed_bootstrap: 400, feed_total: 400 });
		}
	);

	it.each([401, 403])(
		'invalidates reusable data through the SDK, endpoint, and client adapter after HTTP %s',
		async (status) => {
			// Model SvelteKit's HttpError-to-response boundary; the SDK, endpoint, adapter,
			// and controller below all use their actual implementations.
			const apiStatuses: number[] = [];
			vi.spyOn(console, 'error').mockImplementation(() => {});
			vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
				const e = event();
				e.request = new Request(new URL(String(input), 'http://localhost'), init);
				let response: Response;
				try {
					response = await GET(e as unknown as Parameters<typeof GET>[0]);
				} catch (failure) {
					if (!isHttpError(failure)) throw failure;
					response = Response.json(failure.body, { status: failure.status });
				}
				apiStatuses.push(response.status);
				return response;
			});
			const controller = createRateFeedController({ readLatest: readLatestRateFeed });
			const identity = { userId: 'fixture-owner', accessToken: 'fixture-token' };
			controller.setOwner(identity.userId);
			const entry = controller.enter();
			setup();
			const first = controller.prepare(identity);
			await vi.runAllTimersAsync();
			const firstPayload = await first;
			controller.setActiveBooks(entry, firstPayload!.books, 'replace');
			controller.setInitialLoading(entry, false);
			const active = get(controller).activeBooks;
			expect(get(controller).preparedSnapshot).not.toBeNull();

			const rejectedCalls = setup(
				{ code: 'ACCESS_REJECTED', message: 'Private upstream details' },
				status
			);
			const rejected = controller.prepare(identity, { force: true }).catch((failure) => failure);
			await vi.runAllTimersAsync();
			expect(await rejected).toBeInstanceOf(RateFeedReadError);
			expect(await rejected).toMatchObject({ status });
			expect(get(controller).preparedSnapshot).toBeNull();
			expect(get(controller).activeBooks).toBe(active);
			expect(get(controller).loadingInitial).toBe(false);
			expect(rejectedCalls).toHaveLength(1);

			const retryCalls = setup();
			const generate = vi.fn();
			const choice = controller.resolveInitial(
				controller.enter(),
				{ ...identity, accessToken: 'restored-token' },
				generate
			);
			await vi.runAllTimersAsync();
			expect(await choice).toMatchObject({ kind: 'curated' });
			expect(generate).not.toHaveBeenCalled();
			expect(retryCalls).toHaveLength(1);
			expect(fixture.createWithAuth).toHaveBeenLastCalledWith('restored-token');
			expect(apiStatuses).toEqual([200, status, 200]);
			controller.destroy();
		}
	);

	it.each([
		null,
		[],
		{ ...bootstrap(), mode: 'unexpected_mode' },
		{ ...bootstrap(), ratings_count: undefined },
		{ ...bootstrap(), books: null },
		{ ...bootstrap(), books: [{ book_id: 'missing-uuid' }] }
	])(
		'fails malformed RPC responses as load errors rather than empty feeds: %j',
		async (payload) => {
			const calls = setup(payload);
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const e = event();

			expect(await getFailure(e)).toMatchObject({ status: 500 });
			expect(calls).toHaveLength(1);
			expect(timings(e)).toEqual({ feed_bootstrap: 400, feed_total: 400 });
		}
	);

	it('rejects requests without authorization before making any upstream calls', async () => {
		const calls = setup();

		expect(await getFailure(event('', false))).toMatchObject({ status: 401 });
		expect(calls).toHaveLength(0);
		expect(fixture.createWithAuth).not.toHaveBeenCalled();
	});
});
