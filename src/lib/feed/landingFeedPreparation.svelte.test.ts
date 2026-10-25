import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { render } from 'vitest-browser-svelte';
import type { Session } from '@supabase/supabase-js';
import { authStore, markAuthInitChecking, markAuthInitReady } from '$lib/stores/auth';
import {
	createRateFeedController,
	type LatestFeedStateResponse,
	type RateFeedController
} from './rateFeedController';
import LandingFeedHarness from './test-support/LandingFeedHarness.svelte';

vi.mock('$lib/maintenance', () => ({ MAINTENANCE_ON: false }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
const session = (id = 'owner', anonymous = false) =>
	({
		access_token: 'fixture-token',
		user: { id, is_anonymous: anonymous }
	}) as Session;
let controller: RateFeedController;
type ReadLatest = Parameters<typeof createRateFeedController>[0]['readLatest'];
let readLatest: ReturnType<typeof vi.fn<ReadLatest>>;
const payload: LatestFeedStateResponse = {
	mode: 'below_threshold',
	books: [],
	request_id: '',
	latest_request_id: null,
	latest_request_status: null,
	latest_request_error_message: null,
	ratings_count: 0,
	interaction_count: 0,
	eligible_for_feed: false,
	status: 'none',
	error_message: null
};
let view: ReturnType<typeof render>;
async function settle() {
	await tick();
	await Promise.resolve();
	await tick();
}
beforeEach(() => {
	readLatest = vi.fn<ReadLatest>().mockResolvedValue(payload);
	controller = createRateFeedController({ readLatest });
	controller.setOwner('owner');
	authStore.setSession(session());
	markAuthInitReady();
});
afterEach(() => {
	view?.unmount();
	controller.destroy();
	authStore.setSession(null);
});

describe('landing-page feed preparation', () => {
	it('waits for session restoration and controller ownership, then prepares once', async () => {
		markAuthInitChecking();
		controller.setOwner(null);
		view = render(LandingFeedHarness, { controller });
		await settle();
		expect(readLatest).not.toHaveBeenCalled();
		markAuthInitReady();
		await settle();
		expect(readLatest).not.toHaveBeenCalled();
		controller.setOwner('owner');
		await settle();
		expect(readLatest).toHaveBeenCalledTimes(1);
		authStore.setSession({ ...session(), access_token: 'refreshed' });
		await settle();
		expect(readLatest).toHaveBeenCalledTimes(1);
	});

	it('prepares an existing signed-in anonymous session', async () => {
		authStore.setSession(session('owner', true));
		view = render(LandingFeedHarness, { controller });
		await settle();
		expect(readLatest).toHaveBeenCalledTimes(1);
	});

	it('does not prepare for signed-out visitors', async () => {
		authStore.setSession(null);
		view = render(LandingFeedHarness, { controller });
		await settle();
		expect(readLatest).not.toHaveBeenCalled();
	});

	it('does not retry a failed preparation on controller or same-account token updates', async () => {
		readLatest.mockRejectedValue(new Error('Unavailable'));
		view = render(LandingFeedHarness, { controller });
		await settle();
		authStore.setSession({ ...session(), access_token: 'refreshed' });
		controller.invalidatePrepared();
		await settle();
		expect(readLatest).toHaveBeenCalledTimes(1);
	});

	it('prepares the new account and does not repopulate it with an old account response', async () => {
		let finish!: (value: LatestFeedStateResponse) => void;
		readLatest.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve;
			})
		);
		view = render(LandingFeedHarness, { controller });
		await settle();
		const oldSignal = readLatest.mock.calls[0][1];
		authStore.setSession(session('next-owner'));
		controller.setOwner('next-owner');
		await settle();
		expect(oldSignal.aborted).toBe(true);
		expect(readLatest).toHaveBeenCalledTimes(2);
		expect(readLatest.mock.calls[1][0].userId).toBe('next-owner');
		finish({ ...payload, mode: 'has_eligible_feed' });
		await settle();
		expect(readLatest).toHaveBeenCalledTimes(2);
		expect(get(controller).preparedSnapshot?.ownerId).toBe('next-owner');
		expect(get(controller).preparedSnapshot?.payload.mode).toBe('below_threshold');
	});

	it('retains preparation after unmount so rate entry joins the same read', async () => {
		let finish!: (value: LatestFeedStateResponse) => void;
		readLatest.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve;
			})
		);
		view = render(LandingFeedHarness, { controller });
		await settle();
		const signal = readLatest.mock.calls[0][1];
		view.unmount();
		const generate = vi.fn();
		const choice = controller.resolveInitial(
			controller.enter(),
			{ userId: 'owner', accessToken: 'fixture-token' },
			generate
		);
		finish(payload);
		expect(await choice).toMatchObject({ kind: 'popular' });
		expect(signal.aborted).toBe(false);
		expect(readLatest).toHaveBeenCalledTimes(1);
		expect(generate).not.toHaveBeenCalled();
	});
});
