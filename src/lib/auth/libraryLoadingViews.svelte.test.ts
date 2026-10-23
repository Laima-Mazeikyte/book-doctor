import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Session } from '@supabase/supabase-js';
import Bookshelf from '../../routes/my-bookshelf/+page.svelte';
import { authStore, markAuthInitReady } from '$lib/stores/auth';
import { libraryLoads } from '$lib/stores/libraryLoads';
import { librarySaves } from '$lib/stores/librarySaves';
import { bookmarksPageStore } from '$lib/stores/bookmarksPage';

vi.mock('$app/stores', async () => ({
	page: (await import('svelte/store')).writable({
		url: new URL('http://localhost/my-bookshelf?filter=rated'),
		state: {}
	})
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), pushState: vi.fn(), replaceState: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

afterEach(() => {
	libraryLoads.reset();
	bookmarksPageStore.reset();
	authStore.setSession(null);
	vi.unstubAllGlobals();
});

it('waits for Retry after exhaustion across token refreshes, and retries when the view is reopened', async () => {
	const session = (token: string) =>
		({ user: { id: 'view-reader' }, access_token: token }) as Session;
	librarySaves.activateOwner('view-reader');
	libraryLoads.reset();
	authStore.setSession(session('first-token'));
	markAuthInitReady();
	libraryLoads.markSnapshot('view-reader', ['bookmarks', 'dismissals', 'ratedDetails']);
	const read = vi.fn(async () => {
		throw Object.assign(new Error('Denied'), { status: 403 });
	});
	libraryLoads.register('view-reader', 'ratings', read, 1, () => true);
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ books: [] }))
	);

	const first = render(Bookshelf);
	await expect.element(first.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
	expect(read).toHaveBeenCalledOnce();
	authStore.setSession(session('refreshed-token'));
	await tick();
	await new Promise(requestAnimationFrame);
	expect(read).toHaveBeenCalledOnce();
	first.unmount();

	const reopened = render(Bookshelf);
	await expect.poll(() => read.mock.calls.length).toBe(2);
	await expect.element(reopened.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
	reopened.unmount();
});
