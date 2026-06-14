import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';

import {
	authInitStore,
	markAuthInitChecking,
	markAuthInitError,
	markAuthInitReady,
	waitForAuthReady
} from './auth';

describe('auth init readiness', () => {
	it('resolves immediately when already ready', async () => {
		markAuthInitReady();
		await expect(waitForAuthReady()).resolves.toBeUndefined();
		expect(get(authInitStore).status).toBe('ready');
	});

	it('resolves when restore settles after wait started', async () => {
		markAuthInitChecking();
		const pending = waitForAuthReady();
		markAuthInitReady();
		await expect(pending).resolves.toBeUndefined();
	});

	it('resolves on error so callers do not hang', async () => {
		markAuthInitChecking();
		const pending = waitForAuthReady();
		markAuthInitError('network');
		await expect(pending).resolves.toBeUndefined();
		expect(get(authInitStore).status).toBe('error');
		expect(get(authInitStore).error).toBe('network');
	});
});
