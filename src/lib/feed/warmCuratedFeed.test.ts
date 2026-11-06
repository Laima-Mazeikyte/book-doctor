import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { FEED_TIMEOUT_MS, insertFeedRequestRow, pollCuratedFeedRequest } from './warmCuratedFeed';
import { REQUEST_TIMEOUT_MS, RequestTimeoutError } from '$lib/requests/timeout';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it('returns only the public ID from a newly inserted feed and uses it for polling', async () => {
	const fetcher = vi.fn(async (input: RequestInfo | URL) => {
		const url = new URL(String(input));
		expect(url.searchParams.get('select')).toBe('public_id');
		return Response.json({ public_id: 'FeedRunA' });
	});
	const client = createClient('https://feed-id.test', 'public-key', {
		db: { retry: false },
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: { fetch: fetcher }
	});
	const id = await insertFeedRequestRow(client, 'reader');
	expect(id).toBe('FeedRunA');
	const poll = vi.fn(async () => Response.json({ status: 'completed', books: [] }));
	vi.stubGlobal('fetch', poll);
	await expect(pollCuratedFeedRequest(id!, 'token')).resolves.toEqual({
		kind: 'completed',
		books: []
	});
	expect(poll).toHaveBeenCalledWith('/api/feed?request_id=FeedRunA', expect.any(Object));
});

it('bounds a stalled response body and distinguishes caller cancellation', async () => {
	vi.useFakeTimers();
	const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
	vi.stubGlobal('fetch', fetcher);
	const pending = pollCuratedFeedRequest('42', 'token');
	await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
	await expect(pending).resolves.toEqual({ kind: 'timeout' });
	expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
	const controller = new AbortController();
	const cancelled = pollCuratedFeedRequest('42', 'token', controller.signal);
	controller.abort(new Error('navigation'));
	await expect(cancelled).resolves.toEqual({ kind: 'aborted' });
	expect(vi.getTimerCount()).toBe(0);
});

it('enforces the overall deadline during sleep without starting another job', async () => {
	vi.useFakeTimers();
	const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'pending' }));
	// Each response body is consumed once.
	fetcher.mockImplementation(async () => Response.json({ status: 'pending' }));
	vi.stubGlobal('fetch', fetcher);
	const pending = pollCuratedFeedRequest('42', 'token');
	await vi.advanceTimersByTimeAsync(FEED_TIMEOUT_MS);
	await expect(pending).resolves.toEqual({ kind: 'timeout' });
	const count = fetcher.mock.calls.length;
	await vi.advanceTimersByTimeAsync(30_000);
	expect(fetcher).toHaveBeenCalledTimes(count);
	expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('request_id=42'))).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
});

it('does not automatically repeat an unacknowledged job insert', async () => {
	vi.useFakeTimers();
	const fetcher = vi.fn(() => new Promise<Response>(() => {}));
	const client = createClient('https://feed-timeout.test', 'public-key', {
		db: { retry: false },
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: { fetch: fetcher }
	});
	const pending = insertFeedRequestRow(client, 'uncertain-reader');
	const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
	await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
	await assertion;
	await expect(insertFeedRequestRow(client, 'uncertain-reader')).rejects.toBeInstanceOf(
		RequestTimeoutError
	);
	expect(fetcher).toHaveBeenCalledTimes(1);
});
