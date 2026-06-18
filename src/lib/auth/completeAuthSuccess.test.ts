import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	beginAuthTransition,
	clearAuthTransition,
	completeAuthSuccess,
	isAuthTransitionActive
} from './completeAuthSuccess';

const refreshSession = vi.fn();
const getSession = vi.fn();

vi.mock('$lib/supabase', () => ({
	getSupabase: () => ({
		auth: { refreshSession, getSession }
	})
}));

describe('completeAuthSuccess', () => {
	beforeEach(() => {
		clearAuthTransition();
		refreshSession.mockReset();
		getSession.mockReset();
		refreshSession.mockResolvedValue({ data: { session: null }, error: null });
		getSession.mockResolvedValue({ data: { session: null }, error: null });
		vi.stubGlobal('window', {
			dispatchEvent: vi.fn()
		});
	});

	it('clears auth transition and dispatches signed-in event', async () => {
		beginAuthTransition();
		expect(isAuthTransitionActive()).toBe(true);

		await completeAuthSuccess({ previousAnonymousUserId: 'anon-id' });

		expect(isAuthTransitionActive()).toBe(false);
		expect(refreshSession).toHaveBeenCalledOnce();
		expect(window.dispatchEvent).toHaveBeenCalledOnce();
	});

	it('falls back to getSession when refreshSession fails', async () => {
		refreshSession.mockResolvedValue({
			data: { session: null },
			error: new Error('refresh failed')
		});

		await completeAuthSuccess();

		expect(getSession).toHaveBeenCalledOnce();
		expect(isAuthTransitionActive()).toBe(false);
	});
});
