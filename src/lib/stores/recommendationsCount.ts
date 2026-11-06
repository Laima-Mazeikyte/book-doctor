import { withTimeout } from '$lib/requests/timeout';
import { writable } from 'svelte/store';
import { authStore } from './auth';

let generation = 0;
let owner: string | undefined;
authStore.subscribe(({ user }) => {
	if (user?.id !== owner) {
		owner = user?.id;
		generation++;
	}
});

/**
 * Total count of unique recommended books (from all recommendation runs).
 * Populated by the layout when the user is signed in, and refreshed when
 * recommendations load (e.g. after a new run completes) so the header nav
 * stays in sync for anonymous users.
 */
export const recommendationsCountStore = writable<number>(0);

export async function refreshRecommendationsCountFromApi(
	accessToken: string | null
): Promise<boolean> {
	if (!accessToken) return false;
	const current = ++generation;
	try {
		const count = await withTimeout(async (signal) => {
			const res = await fetch('/api/recommendations/count', {
				headers: { Authorization: `Bearer ${accessToken}` },
				signal
			});
			// On a transient failure leave the last-known count intact rather than zeroing it:
			// `0` is also the legitimate "no recommendations" value, and clobbering a good count
			// hides the primary nav for anonymous users (see AppHeader `showMainNav`). Sign-out
			// resets the count authoritatively elsewhere; callers retry on the returned `false`.
			if (!res.ok) {
				throw new Error('Unable to load count');
			}
			const data = await res.json();
			return data.count ?? 0;
		});
		if (current !== generation) return false;
		recommendationsCountStore.set(count);
		return true;
	} catch {
		return false;
	}
}
