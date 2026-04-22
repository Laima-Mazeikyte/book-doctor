import { writable } from 'svelte/store';

/**
 * Total count of unique recommended books (from all recommendation runs).
 * Populated by the layout when the user is signed in, and refreshed when
 * recommendations load (e.g. after a new run completes) so the header nav
 * stays in sync for anonymous users.
 */
export const recommendationsCountStore = writable<number>(0);

export async function refreshRecommendationsCountFromApi(accessToken: string | null): Promise<void> {
	if (!accessToken) return;
	try {
		const res = await fetch('/api/recommendations/count', {
			headers: { Authorization: `Bearer ${accessToken}` }
		});
		const data = res.ok ? await res.json() : { count: 0 };
		recommendationsCountStore.set(data.count ?? 0);
	} catch {
		recommendationsCountStore.set(0);
	}
}
