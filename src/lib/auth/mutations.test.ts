import { afterEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasPendingAuthMutation, runAuthMutation } from './mutations';
import { REQUEST_TIMEOUT_MS, RequestTimeoutError } from '$lib/requests/timeout';

afterEach(() => vi.useRealTimers());

it.each(['resolve', 'reject'] as const)(
	'blocks overlapping account changes after timeout until the SDK settles with %s',
	async (settlement) => {
		vi.useFakeTimers();
		const client = {} as SupabaseClient;
		let resolve!: (value: string) => void;
		let reject!: (error: Error) => void;
		const sdk = new Promise<string>((yes, no) => {
			resolve = yes;
			reject = no;
		});
		const first = runAuthMutation(client, () => sdk);
		const timedOut = expect(first).rejects.toBeInstanceOf(RequestTimeoutError);
		await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
		await timedOut;
		expect(hasPendingAuthMutation(client)).toBe(true);
		const newerLogin = vi.fn(async () => 'new session');
		await expect(runAuthMutation(client, newerLogin)).rejects.toThrow('still being confirmed');
		expect(newerLogin).not.toHaveBeenCalled();
		if (settlement === 'resolve') resolve('old session');
		else reject(new Error('late SDK failure'));
		await vi.advanceTimersByTimeAsync(0);
		expect(hasPendingAuthMutation(client)).toBe(false);
		await expect(runAuthMutation(client, newerLogin)).resolves.toBe('new session');
		expect(vi.getTimerCount()).toBe(0);
	}
);

it('does not start a mutation after lifecycle cancellation', async () => {
	const client = {} as SupabaseClient;
	const controller = new AbortController();
	controller.abort();
	const sdk = vi.fn();
	await expect(runAuthMutation(client, sdk, { signal: controller.signal })).rejects.toMatchObject({
		name: 'AbortError'
	});
	expect(sdk).not.toHaveBeenCalled();
	expect(hasPendingAuthMutation(client)).toBe(false);
});
