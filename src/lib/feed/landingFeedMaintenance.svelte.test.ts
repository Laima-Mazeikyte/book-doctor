import { expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import type { Session } from '@supabase/supabase-js';
import { authStore, markAuthInitReady } from '$lib/stores/auth';
import { createRateFeedController } from './rateFeedController';
import LandingFeedHarness from './test-support/LandingFeedHarness.svelte';

vi.mock('$lib/maintenance', () => ({ MAINTENANCE_ON: true }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

it('does not prepare an existing session during maintenance', async () => {
	const readLatest = vi.fn();
	const controller = createRateFeedController({ readLatest });
	controller.setOwner('owner');
	authStore.setSession({ access_token: 'fixture-token', user: { id: 'owner' } } as Session);
	markAuthInitReady();
	const view = render(LandingFeedHarness, { controller });
	try {
		await tick();
		expect(readLatest).not.toHaveBeenCalled();
	} finally {
		view.unmount();
		controller.destroy();
		authStore.setSession(null);
	}
});
