import { writable } from 'svelte/store';

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
	try {
		const res = await fetch('/api/recommendations/count', {
			headers: { Authorization: `Bearer ${accessToken}` }
		});
		// On a transient failure leave the last-known count intact rather than zeroing it:
		// `0` is also the legitimate "no recommendations" value, and clobbering a good count
		// hides the primary nav for anonymous users (see AppHeader `showMainNav`). Sign-out
		// resets the count authoritatively elsewhere; callers retry on the returned `false`.
		if (!res.ok) {
			return false;
		}
		const data = await res.json();
		recommendationsCountStore.set(data.count ?? 0);
		return true;
	} catch {
		return false;
	}
}
