import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { completeAuthSuccess } from './completeAuthSuccess';
import { REQUEST_TIMEOUT_MS } from '$lib/requests/timeout';

const refreshSession = vi.fn();
const getSession = vi.fn();

vi.mock('$lib/supabase', () => ({
	getSupabase: () => ({
		auth: { refreshSession, getSession }
	})
}));

describe('completeAuthSuccess', () => {
	beforeEach(() => {
		refreshSession.mockReset();
		getSession.mockReset();
		refreshSession.mockResolvedValue({ data: { session: null }, error: null });
		getSession.mockResolvedValue({ data: { session: null }, error: null });
		vi.stubGlobal('window', {
			dispatchEvent: vi.fn()
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('refreshes claims and dispatches the signed-in event', async () => {
		await completeAuthSuccess();

		expect(refreshSession).toHaveBeenCalledOnce();
		expect(window.dispatchEvent).toHaveBeenCalledOnce();
		expect(vi.mocked(window.dispatchEvent).mock.calls[0][0].type).toBe('auth:signed-in');
	});

	it('falls back to getSession when refreshSession fails', async () => {
		refreshSession.mockResolvedValue({
			data: { session: null },
			error: new Error('refresh failed')
		});

		await completeAuthSuccess();

		expect(getSession).toHaveBeenCalledOnce();
		expect(window.dispatchEvent).toHaveBeenCalledOnce();
	});

	it('keeps confirmed sign-in successful when follow-up refresh stalls', async () => {
		vi.useFakeTimers();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		refreshSession.mockReturnValue(new Promise(() => {}));
		const completion = completeAuthSuccess();
		await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
		await expect(completion).resolves.toBeUndefined();
		expect(window.dispatchEvent).toHaveBeenCalledOnce();
		expect(getSession).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
