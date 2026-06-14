import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';

import {
	clearUserLibraryHydration,
	markUserLibraryHydrationReady,
	markUserLibraryHydrationStarted,
	userLibraryHydrationStore,
	waitForUserLibraryHydration
} from './userLibrary';

describe('user library hydration', () => {
	it('resolves immediately when userId is null', async () => {
		await expect(waitForUserLibraryHydration(null)).resolves.toBeUndefined();
	});

	it('resolves when hydration completes for the active user', async () => {
		markUserLibraryHydrationStarted('user-1');
		const pending = waitForUserLibraryHydration('user-1');
		markUserLibraryHydrationReady('user-1');
		await expect(pending).resolves.toBeUndefined();
		expect(get(userLibraryHydrationStore)).toEqual({ userId: 'user-1', ready: true });
	});

	it('treats cleared hydration as ready for signed-out restore', async () => {
		clearUserLibraryHydration();
		await expect(waitForUserLibraryHydration(null)).resolves.toBeUndefined();
		expect(get(userLibraryHydrationStore)).toEqual({ userId: null, ready: true });
	});
});
