import { browser } from '$app/environment';
import { error } from '@sveltejs/kit';
import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth';
import type { PageLoad } from './$types';

// The root layout restores browser auth. Revalidation after restoration resolves old links to 404.
export const load: PageLoad = async ({ url, fetch }) => {
	if (!browser) return {};
	const token = get(authStore).session?.access_token;
	const id = url.searchParams.get('request_id');
	if (!token || !id) return {};
	try {
		const response = await fetch(
			'/api/recommendations?metadata=1&request_id=' + encodeURIComponent(id),
			{ headers: { Authorization: 'Bearer ' + token } }
		);
		if (response.status === 404) throw error(404);
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause && cause.status === 404)
			throw cause;
		// Transient failures use the page's existing retry UI.
	}
	return {};
};
