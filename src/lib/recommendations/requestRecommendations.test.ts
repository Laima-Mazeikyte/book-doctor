import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Session } from '@supabase/supabase-js';
import { goto } from '$app/navigation';
import { getSupabase } from '$lib/supabase';
import { authStore } from '$lib/stores/auth';
import { librarySaves } from '$lib/stores/librarySaves';
import { markUserLibraryIdsReady, clearUserLibraryHydration } from '$lib/stores/userLibrary';
import { createRecommendationSubmission } from './requestRecommendations';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/supabase', () => ({ getSupabase: vi.fn() }));

function session(userId = 'A', token = 'token'): Session {
	return { access_token: token, user: { id: userId } } as Session;
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
const success = { data: { id: 42 }, error: null };
const destination = '/rate/recommendations/shortlist?request_id=42';

describe('recommendation submission', () => {
	let submission: ReturnType<typeof createRecommendationSubmission>;
	let insert: ReturnType<typeof vi.fn>;
	let single: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.mocked(goto).mockReset().mockResolvedValue(undefined);
		vi.spyOn(librarySaves, 'flush').mockResolvedValue();
		authStore.setSession(session());
		markUserLibraryIdsReady('A');
		single = vi.fn().mockResolvedValue(success);
		insert = vi.fn().mockReturnValue({ select: () => ({ single }) });
		vi.mocked(getSupabase).mockReturnValue({ from: () => ({ insert }) } as never);
		submission = createRecommendationSubmission();
	});

	afterEach(() => {
		submission.destroy();
		vi.restoreAllMocks();
	});

	it('blocks repeated submissions while flushing, inserting, and navigating', async () => {
		const flush = deferred<void>();
		const response = deferred<typeof success>();
		const navigation = deferred<void>();
		vi.mocked(librarySaves.flush).mockReturnValue(flush.promise);
		single.mockReturnValue(response.promise);
		vi.mocked(goto).mockReturnValue(navigation.promise);
		const first = submission.submit();
		await submission.submit();
		expect(get(submission).status).toBe('submitting');
		expect(librarySaves.flush).toHaveBeenCalledTimes(1);
		expect(insert).not.toHaveBeenCalled();
		flush.resolve();
		await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
		await submission.submit();
		response.resolve(success);
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith(destination));
		await submission.submit();
		expect(get(submission).status).toBe('submitting');
		expect(insert).toHaveBeenCalledTimes(1);
		navigation.resolve();
		await first;
		expect(get(submission).status).toBe('idle');
	});

	it.each([
		{ data: null, error: { message: 'Database unavailable' } },
		{ data: null, error: null }
	])(
		'exposes failed creation without navigating or automatically retrying (%j)',
		async (result) => {
			single.mockResolvedValueOnce(result);
			await submission.submit();
			expect(get(submission)).toEqual({ status: 'error', error: 'start' });
			expect(goto).not.toHaveBeenCalled();
			expect(insert).toHaveBeenCalledTimes(1);
			await submission.submit();
			expect(insert).toHaveBeenCalledTimes(2);
			expect(goto).toHaveBeenCalledWith(destination);
		}
	);

	it('handles thrown transport errors and a missing client', async () => {
		single.mockRejectedValueOnce(new Error('Offline'));
		await submission.submit();
		expect(get(submission).error).toBe('start');
		vi.mocked(getSupabase).mockReturnValue(null);
		await submission.submit();
		expect(get(submission).error).toBe('start');
		expect(goto).not.toHaveBeenCalled();
	});

	it('reopens the confirmed request after navigation failure without inserting or flushing again', async () => {
		vi.mocked(goto).mockRejectedValueOnce(new Error('Route unavailable'));
		await submission.submit();
		expect(get(submission)).toEqual({ status: 'error', error: 'open' });
		vi.mocked(librarySaves.flush).mockRejectedValue(new Error('New unsaved changes'));
		await submission.submit();
		expect(insert).toHaveBeenCalledTimes(1);
		expect(librarySaves.flush).toHaveBeenCalledTimes(1);
		expect(vi.mocked(goto).mock.calls).toEqual([[destination], [destination]]);
	});

	it.each(['flush', 'insert'] as const)(
		'ignores a late %s response after leaving the page',
		async (phase) => {
			const wait = deferred<never>();
			if (phase === 'flush') vi.mocked(librarySaves.flush).mockReturnValue(wait.promise);
			else single.mockReturnValue(wait.promise);
			const first = submission.submit();
			if (phase === 'insert') await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
			submission.leave(new URL('http://localhost/my-bookshelf'));
			wait.resolve(success as never);
			await first;
			expect(goto).not.toHaveBeenCalled();
			expect(get(submission).status).toBe('idle');
		}
	);

	it('stays busy during its own navigation and permits another run after it completes', async () => {
		vi.mocked(goto).mockImplementation(async () => {
			submission.leave(new URL(`http://localhost${destination}`));
			expect(get(submission).status).toBe('submitting');
		});
		await submission.submit();
		await submission.submit();
		expect(insert).toHaveBeenCalledTimes(2);
	});

	it.each(['sign-out', 'switch-back'] as const)(
		'invalidates late responses on %s',
		async (change) => {
			const response = deferred<typeof success>();
			single.mockReturnValue(response.promise);
			const first = submission.submit();
			await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
			authStore.setSession(change === 'sign-out' ? null : session('B'));
			if (change === 'switch-back') authStore.setSession(session('A'));
			response.resolve(success);
			await first;
			expect(goto).not.toHaveBeenCalled();
			expect(get(submission).status).toBe('idle');
		}
	);

	it('keeps an in-flight submission across token refresh', async () => {
		const response = deferred<typeof success>();
		single.mockReturnValue(response.promise);
		const first = submission.submit();
		await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
		authStore.setSession(session('A', 'new-token'));
		response.resolve(success);
		await first;
		expect(goto).toHaveBeenCalledWith(destination);
	});

	it('requires saved changes, a usable library, and an active account', async () => {
		vi.mocked(librarySaves.flush).mockRejectedValueOnce(new Error('Save failed'));
		await submission.submit();
		expect(get(submission).error).toBe('start');
		clearUserLibraryHydration();
		await submission.submit();
		authStore.setSession(null);
		await submission.submit();
		expect(insert).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});

	it('discards a previous account request ID before retrying in the new account', async () => {
		vi.mocked(goto).mockRejectedValueOnce(new Error('Route unavailable'));
		await submission.submit();
		authStore.setSession(session('B'));
		markUserLibraryIdsReady('B');
		await submission.submit();
		expect(insert.mock.calls).toEqual([[{ user_id: 'A' }], [{ user_id: 'B' }]]);
	});

	it('ignores late responses after unmount and cannot submit after destruction', async () => {
		const response = deferred<typeof success>();
		single.mockReturnValue(response.promise);
		const first = submission.submit();
		await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
		submission.destroy();
		response.resolve(success);
		await first;
		await submission.submit();
		expect(insert).toHaveBeenCalledTimes(1);
		expect(goto).not.toHaveBeenCalled();
	});
});
