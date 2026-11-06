import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { pollImportJob } from './importJobs';

const fixture = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$lib/supabase', () => ({ getSupabase: () => fixture.client }));
afterEach(() => vi.useRealTimers());

function client(fetcher: typeof fetch) {
	fixture.client = createClient('https://import-timeout.test', 'public-key', {
		db: { retry: false },
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: { fetch: fetcher }
	});
}

it('expires while a status read ignores cancellation', async () => {
	vi.useFakeTimers();
	const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
	client(fetcher);
	const pending = pollImportJob('existing-job', { timeoutMs: 250 });
	await vi.advanceTimersByTimeAsync(250);
	await expect(pending).resolves.toEqual({ status: 'timeout' });
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
});

it('expires while sleeping and cancels without another poll', async () => {
	vi.useFakeTimers();
	const fetcher = vi.fn<typeof fetch>(async () =>
		Response.json({ status: 'pending', matched_count: 0, unmatched: [], error: null })
	);
	client(fetcher);
	const pending = pollImportJob('existing-job', { timeoutMs: 250, intervalMs: 1000 });
	await vi.advanceTimersByTimeAsync(250);
	await expect(pending).resolves.toEqual({ status: 'timeout' });
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(vi.getTimerCount()).toBe(0);
});
