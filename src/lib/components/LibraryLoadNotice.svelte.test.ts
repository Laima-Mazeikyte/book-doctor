import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Session } from '@supabase/supabase-js';
import { authStore } from '$lib/stores/auth';
import { libraryLoads, type LibraryLoadSnapshot } from '$lib/stores/libraryLoads';
import LibraryLoadNotice from './LibraryLoadNotice.svelte';

vi.mock('$lib/stores/libraryLoads', async () => {
	const { writable } = await import('svelte/store');
	return {
		libraryLoads: {
			...writable<LibraryLoadSnapshot>({
				userId: null,
				collections: {} as LibraryLoadSnapshot['collections']
			}),
			visit: vi.fn().mockResolvedValue(undefined),
			retry: vi.fn().mockResolvedValue(undefined)
		}
	};
});

const loads = libraryLoads as typeof libraryLoads & {
	set: (snapshot: LibraryLoadSnapshot) => void;
};
let snapshot: LibraryLoadSnapshot;
let unmount: (() => void) | undefined;

beforeEach(() => {
	vi.clearAllMocks();
	authStore.setSession({ user: { id: 'notice-reader' }, access_token: 'token' } as Session);
	snapshot = {
		userId: 'notice-reader',
		collections: Object.fromEntries(
			['ratings', 'bookmarks', 'dismissals', 'ratedDetails', 'bookmarkDetails'].map((kind) => [
				kind,
				{ status: 'ready', hasSnapshot: true, error: null }
			])
		) as LibraryLoadSnapshot['collections']
	};
	loads.set(snapshot);
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
	authStore.setSession(null);
});

function fixture() {
	const rendered = render(LibraryLoadNotice, {
		collections: ['ratings', 'bookmarks', 'dismissals', 'ratedDetails']
	});
	unmount = () => rendered.unmount();
	return rendered;
}

it('does not show a failure during initial loading or cached revalidation', async () => {
	snapshot.collections.ratings = { status: 'loading', hasSnapshot: false, error: null };
	snapshot.collections.ratedDetails = { status: 'loading', hasSnapshot: true, error: null };
	loads.set(snapshot);
	const rendered = fixture();
	await tick();
	await expect.element(rendered.getByTestId('library-load-notice')).not.toBeInTheDocument();
});

it('shows only retry status while a failed refresh is still being retried', async () => {
	snapshot.collections.ratedDetails = {
		status: 'retrying',
		hasSnapshot: true,
		error: 'Temporary failure'
	};
	loads.set(snapshot);
	const rendered = fixture();
	const notice = rendered.getByRole('status');
	await expect.element(notice).toHaveTextContent('Retrying...');
	await expect.element(notice).not.toHaveTextContent('Couldn’t refresh');
	await expect.element(rendered.getByRole('alert')).not.toBeInTheDocument();
	await expect
		.element(rendered.getByRole('button', { name: 'Retry', exact: true }))
		.not.toBeInTheDocument();
	snapshot.collections.ratedDetails = { status: 'ready', hasSnapshot: true, error: null };
	loads.set({ ...snapshot });
	await expect.element(rendered.getByTestId('library-load-notice')).not.toBeInTheDocument();
});

it('does not declare an initial load failed while automatic retries continue', async () => {
	snapshot.collections.ratings = {
		status: 'retrying',
		hasSnapshot: false,
		error: 'Temporary failure'
	};
	loads.set(snapshot);
	const rendered = fixture();
	await expect.element(rendered.getByRole('status')).toHaveTextContent('Retrying...');
	await expect.element(rendered.getByRole('status')).not.toHaveTextContent('Couldn’t load');
});

it('shows the shortened refresh warning only at terminal failure and retries the failed collection', async () => {
	snapshot.collections.ratedDetails = {
		status: 'retrying',
		hasSnapshot: true,
		error: 'Temporary failure'
	};
	loads.set(snapshot);
	const rendered = fixture();
	await expect.element(rendered.getByRole('status')).toHaveTextContent('Retrying...');
	snapshot.collections.ratedDetails = {
		status: 'error',
		hasSnapshot: true,
		error: 'Retries exhausted'
	};
	loads.set({ ...snapshot });
	await expect
		.element(rendered.getByRole('alert'))
		.toHaveTextContent('Couldn’t refresh your ratings.');
	await expect
		.element(rendered.getByRole('alert'))
		.not.toHaveTextContent('Showing previously loaded books');
	await rendered.getByRole('button', { name: 'Retry', exact: true }).click();
	expect(libraryLoads.retry).toHaveBeenCalledWith(['ratedDetails']);
	snapshot.collections.ratedDetails = { status: 'loading', hasSnapshot: true, error: null };
	loads.set({ ...snapshot });
	await expect.element(rendered.getByRole('alert')).not.toBeInTheDocument();
});

it('labels only terminal failures when another collection is still retrying', async () => {
	snapshot.collections.ratedDetails = { status: 'error', hasSnapshot: true, error: 'Failed' };
	snapshot.collections.bookmarks = { status: 'retrying', hasSnapshot: false, error: 'Retrying' };
	loads.set(snapshot);
	const rendered = fixture();
	await expect
		.element(rendered.getByRole('alert'))
		.toHaveTextContent('Couldn’t refresh your ratings.');
	await expect
		.element(rendered.getByRole('alert'))
		.not.toHaveTextContent('Couldn’t load your books.');
});

it('shows an initial terminal failure without implying an available cached snapshot', async () => {
	snapshot.collections.bookmarks = { status: 'error', hasSnapshot: false, error: 'Failed' };
	loads.set(snapshot);
	const rendered = fixture();
	await expect
		.element(rendered.getByRole('alert'))
		.toHaveTextContent('Couldn’t load your bookmarks.');
	await expect.element(rendered.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});

it('does not expose failures belonging to another account', async () => {
	snapshot.userId = 'other-reader';
	snapshot.collections.ratings = { status: 'error', hasSnapshot: true, error: 'Failed' };
	loads.set(snapshot);
	const rendered = fixture();
	await tick();
	await expect.element(rendered.getByTestId('library-load-notice')).not.toBeInTheDocument();
});
