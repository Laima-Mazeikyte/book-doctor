import { afterEach, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { withRequestTimeout } from './requestTimeout';
import { SERVER_TIMEOUT_MS } from '$lib/requests/timeout';

afterEach(() => vi.useRealTimers());
const event = () =>
	({ request: new Request('https://app.test/api/books/by-author') }) as RequestEvent;

it('returns a private 504 and aborts upstream work even if it never settles', async () => {
	vi.useFakeTimers();
	let upstream: AbortSignal | undefined;
	const pending = withRequestTimeout(async (_, signal) => {
		upstream = signal;
		return new Promise(() => {});
	})(event());
	await vi.advanceTimersByTimeAsync(SERVER_TIMEOUT_MS);
	const response = await pending;
	expect(response.status).toBe(504);
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(await response.json()).toMatchObject({ code: 'request_timeout' });
	expect(upstream?.aborted).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
});

it('preserves an endpoint-specific outage status and ordinary domain errors', async () => {
	vi.useFakeTimers();
	const pending = withRequestTimeout(async () => new Promise(() => {}), 503)(event());
	await vi.advanceTimersByTimeAsync(SERVER_TIMEOUT_MS);
	expect((await pending).status).toBe(503);
	const failure = new Error('domain failure');
	await expect(
		withRequestTimeout(async () => {
			throw failure;
		})(event())
	).rejects.toBe(failure);
});

it('cancels upstream work when the incoming request is cancelled', async () => {
	const controller = new AbortController();
	const incoming = event();
	incoming.request = new Request(incoming.request, { signal: controller.signal });
	let upstream: AbortSignal | undefined;
	const pending = withRequestTimeout(async (_, signal) => {
		upstream = signal;
		return new Promise(() => {});
	})(incoming);
	const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	controller.abort();
	await assertion;
	expect(upstream?.aborted).toBe(true);
});
