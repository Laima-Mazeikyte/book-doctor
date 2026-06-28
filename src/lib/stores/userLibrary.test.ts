import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';

import {
	clearUserLibraryHydration,
	isUserLibraryIdsReady,
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

	it('isUserLibraryIdsReady is false until ids hydrate for the active user', () => {
		const hydration = get(userLibraryHydrationStore);
		expect(isUserLibraryIdsReady('user-1', hydration)).toBe(false);

		markUserLibraryIdsStarted('user-1');
		expect(isUserLibraryIdsReady('user-1', get(userLibraryHydrationStore))).toBe(false);

		markUserLibraryIdsReady('user-1');
		expect(isUserLibraryIdsReady('user-1', get(userLibraryHydrationStore))).toBe(true);
	});

	it('isUserLibraryIdsReady is true with no signed-in user', () => {
		clearUserLibraryHydration();
		expect(isUserLibraryIdsReady(null, get(userLibraryHydrationStore))).toBe(true);
	});
});
