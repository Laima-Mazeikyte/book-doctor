import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
	FEED_POLL_MS,
	FEED_TIMEOUT_MS,
	insertFeedRequestRow,
	pollCuratedFeedRequest
} from './warmCuratedFeed';
import { REQUEST_TIMEOUT_MS, RequestTimeoutError } from '$lib/requests/timeout';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it('checks a pending job every second and stops immediately on completion', async () => {
	vi.useFakeTimers();
	const fetcher = vi
		.fn()
		.mockImplementationOnce(async () => Response.json({ status: 'processing' }))
		.mockImplementationOnce(async () => Response.json({ status: 'completed', books: [] }));
	vi.stubGlobal('fetch', fetcher);
	const pending = pollCuratedFeedRequest('FeedRunA', 'token');
	await vi.advanceTimersByTimeAsync(999);
	expect(fetcher).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(1);
	expect(FEED_POLL_MS).toBe(1000);
	await expect(pending).resolves.toEqual({ kind: 'completed', books: [] });
	await vi.advanceTimersByTimeAsync(10_000);
	expect(fetcher).toHaveBeenCalledTimes(2);
});

it('returns only the public ID from a newly inserted feed and uses it for polling', async () => {
	const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		if (init?.method !== 'POST') return Response.json([]);
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
	const fetcher = vi.fn((_: unknown, init?: RequestInit) =>
		init?.method === 'POST' ? new Promise<Response>(() => {}) : Promise.resolve(Response.json([]))
	);
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
	expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

it('shares a submission and resumes a processing job after polling is cancelled', async () => {
	let current: { public_id: string; status: string; created_at: string } | null = null;
	let writes = 0;
	const client = createClient('https://serialized-feed.test', 'public-key', {
		db: { retry: false },
		auth: { persistSession: false },
		global: {
			fetch: async (_input, init) => {
				if (init?.method !== 'POST') return Response.json(current ? [current] : []);
				writes++;
				current = {
					public_id: 'SharedA1',
					status: 'processing',
					created_at: new Date().toISOString()
				};
				return Response.json({ public_id: current.public_id });
			}
		}
	});
	const first = insertFeedRequestRow(client, 'shared-reader');
	const second = insertFeedRequestRow(client, 'shared-reader');
	expect(first).toBe(second);
	await expect(first).resolves.toBe('SharedA1');
	const controller = new AbortController();
	controller.abort();
	await expect(pollCuratedFeedRequest('SharedA1', 'token', controller.signal)).resolves.toEqual({
		kind: 'aborted'
	});
	await expect(insertFeedRequestRow(client, 'shared-reader')).resolves.toBe('SharedA1');
	expect(writes).toBe(1);
});

it('coordinates independent tabs with Web Locks and recovers an uncertain insert after reload', async () => {
	const storage = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key)
	});
	let tail = Promise.resolve();
	const lock = vi.fn((_name: string, callback: () => Promise<unknown>) => {
		const task = tail.then(callback);
		tail = task.then(() => undefined);
		return task;
	});
	vi.stubGlobal('navigator', { locks: { request: lock } });
	let current: object | null = null;
	let writes = 0;
	const client = createClient('https://cross-tab-feed.test', 'public-key', {
		db: { retry: false },
		auth: { persistSession: false },
		global: {
			fetch: async (_input, init) => {
				if (init?.method !== 'POST') return Response.json(current ? [current] : []);
				writes++;
				current = {
					public_id: 'SharedB1',
					status: 'processing',
					created_at: new Date().toISOString()
				};
				return Response.json({ public_id: 'SharedB1' });
			}
		}
	});
	vi.resetModules();
	const tabA = await import('./warmCuratedFeed');
	vi.resetModules();
	const tabB = await import('./warmCuratedFeed');
	await expect(
		Promise.all([
			tabA.insertFeedRequestRow(client, 'two-tabs'),
			tabB.insertFeedRequestRow(client, 'two-tabs')
		])
	).resolves.toEqual(['SharedB1', 'SharedB1']);
	expect(writes).toBe(1);
	expect(lock).toHaveBeenCalledTimes(2);
	// A response lost during navigation leaves a persisted intent without an ID.
	storage.set('book-doctor:feed-generation:v2:two-tabs', JSON.stringify({ since: Date.now() }));
	current = { public_id: 'SharedB1', status: 'completed', created_at: new Date().toISOString() };
	vi.resetModules();
	const reloaded = await import('./warmCuratedFeed');
	await expect(reloaded.insertFeedRequestRow(client, 'two-tabs')).resolves.toBe('SharedB1');
	expect(writes).toBe(1);
});
