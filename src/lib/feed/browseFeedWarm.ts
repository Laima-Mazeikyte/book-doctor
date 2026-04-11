import { browser } from '$app/environment';
import { resolve } from '$app/paths';
import { get } from 'svelte/store';
import { page } from '$app/stores';
import { authStore } from '$lib/stores/auth';
import { getSupabase } from '$lib/supabase';
import { insertFeedRequestRow, pollCuratedFeedRequest } from '$lib/feed/warmCuratedFeed';

let feedWarmPending = false;
let feedWarmInFlight = false;

/** True when `url` is the main Browse (rate) page, including with `paths.base`. */
export function isRateBrowseUrl(url: URL | undefined): boolean {
	if (!url) return false;
	if (!browser) {
		const p = url.pathname;
		return p === '/rate' || p.endsWith('/rate');
	}
	try {
		const browse = new URL(resolve('/rate'), url.origin);
		return url.pathname === browse.pathname;
	} catch {
		return url.pathname === '/rate' || url.pathname.endsWith('/rate');
	}
}

/**
 * Call from `afterNavigate`: arm when leaving Browse; clear pending when landing on Browse.
 */
export function onAfterNavigateForBrowseFeedWarm(
	fromUrl: URL | undefined,
	toUrl: URL | undefined
): void {
	if (!browser) return;
	if (isRateBrowseUrl(toUrl)) {
		feedWarmPending = false;
		return;
	}
	if (isRateBrowseUrl(fromUrl) && toUrl != null && !isRateBrowseUrl(toUrl)) {
		feedWarmPending = true;
	}
}

/**
 * After a persisted bookmark / not-interested / rating write (user-initiated).
 * Runs at most one background `feed_requests` job per "left browse" stint.
 */
export function notifyLibraryPersistedMutationForBrowseFeedWarm(): void {
	if (!browser) return;
	if (isRateBrowseUrl(get(page).url)) return;
	if (!feedWarmPending || feedWarmInFlight) return;

	const auth = get(authStore);
	const user = auth.user;
	const session = auth.session;
	if (!session?.access_token || !user?.id) {
		feedWarmPending = false;
		return;
	}

	const supabase = getSupabase();
	if (!supabase) {
		feedWarmPending = false;
		return;
	}

	feedWarmPending = false;
	feedWarmInFlight = true;
	const token = session.access_token;
	const userId = user.id;

	void (async () => {
		try {
			const { data: sessionData } = await supabase.auth.getSession();
			if (!sessionData.session) {
				console.warn('[browseFeedWarm] skip warm: no Supabase session on client');
				return;
			}
			const requestId = await insertFeedRequestRow(supabase, userId);
			if (requestId) await pollCuratedFeedRequest(requestId, token);
		} catch (e) {
			console.error('[browseFeedWarm]', e);
		} finally {
			feedWarmInFlight = false;
		}
	})();
}
