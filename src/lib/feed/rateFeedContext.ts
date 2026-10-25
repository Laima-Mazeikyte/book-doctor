import { getContext, setContext } from 'svelte';
import { resolve } from '$app/paths';
import { FEED_REQUEST_BATCH_SIZE } from './constants';
import { createRateFeedCache } from './rateFeedCache';
import {
	createRateFeedController,
	RateFeedReadError,
	type LatestFeedStateResponse,
	type RateFeedController,
	type RateFeedIdentity
} from './rateFeedController';

const RATE_FEED = Symbol('rateFeed');

/** Called only by browser consumers; constructing a layout controller performs no reads. */
export async function readLatestRateFeed(identity: RateFeedIdentity, signal: AbortSignal) {
	const response = await fetch(`${resolve('/api/feed/latest')}?limit=${FEED_REQUEST_BATCH_SIZE}`, {
		headers: { Authorization: `Bearer ${identity.accessToken}` },
		signal
	});
	if (!response.ok) throw new RateFeedReadError(response.status);
	return (await response.json()) as LatestFeedStateResponse;
}

export function createBrowserRateFeedController({
	persistSnapshots = true
} = {}): RateFeedController {
	return createRateFeedController({
		readLatest: readLatestRateFeed,
		cache: persistSnapshots ? createRateFeedCache() : undefined
	});
}

export function setRateFeedContext(controller: RateFeedController): void {
	setContext(RATE_FEED, controller);
}

export function getRateFeedContext(): RateFeedController | undefined {
	return getContext<RateFeedController | undefined>(RATE_FEED);
}
