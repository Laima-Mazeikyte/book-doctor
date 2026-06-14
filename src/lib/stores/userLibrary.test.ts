import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';

import {
	clearUserLibraryHydration,
	markUserLibraryDetailsReady,
	markUserLibraryIdsReady,
	markUserLibraryIdsStarted,
	userLibraryHydrationStore
} from './userLibrary';

describe('user library hydration', () => {
	it('marks id hydration in progress for the active user', () => {
		markUserLibraryIdsStarted('user-1');
		expect(get(userLibraryHydrationStore)).toEqual({
			userId: 'user-1',
			idsReady: false,
			detailsReady: false
		});
	});

	it('marks ids ready and leaves details pending', () => {
		markUserLibraryIdsStarted('user-1');
		markUserLibraryIdsReady('user-1');
		expect(get(userLibraryHydrationStore)).toEqual({
			userId: 'user-1',
			idsReady: true,
			detailsReady: false
		});
	});

	it('marks details ready after deferred hydration completes', () => {
		markUserLibraryIdsStarted('user-1');
		markUserLibraryIdsReady('user-1');
		markUserLibraryDetailsReady('user-1');
		expect(get(userLibraryHydrationStore)).toEqual({
			userId: 'user-1',
			idsReady: true,
			detailsReady: true
		});
	});

	it('treats cleared hydration as ready for signed-out restore', () => {
		clearUserLibraryHydration();
		expect(get(userLibraryHydrationStore)).toEqual({
			userId: null,
			idsReady: true,
			detailsReady: true
		});
	});
});
