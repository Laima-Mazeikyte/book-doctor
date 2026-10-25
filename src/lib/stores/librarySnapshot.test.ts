import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	createLibrarySnapshotController,
	persistLibrarySnapshot,
	restoreLibrarySnapshot
} from './librarySnapshot';
import {
	readLibrarySnapshot,
	writeLibraryCache,
	writeLibrarySnapshot,
	LIBRARY_SNAPSHOT_PREFIX
} from './libraryCache';
import { libraryLoads } from './libraryLoads';
import { librarySaves } from './librarySaves';
import { ratingsStore } from './ratings';
import { planToReadStore } from './planToRead';
import { notInterestedStore } from './notInterested';
import {
	canUseLibraryAction,
	userLibraryHydrationStore,
	LIBRARY_ID_COLLECTIONS
} from './userLibrary';

const owner = 'snapshot-A';
const book = { id: 'uuid', book_id: 'ulid', title: 'Cached book', author: 'Author' };
const rating = { ...book, rating: 4 as const };
let browser: EventTarget & { localStorage: Storage };
let stop: (() => void) | undefined;
function complete() {
	writeLibrarySnapshot(owner, {
		ratings: { entries: [rating], books: [rating] },
		bookmarks: [{ id: 'bookmark-uuid', book_id: 'bookmark-ulid' }],
		dismissals: ['dismissed-ulid']
	});
}
function storageEvent(key: string | null) {
	browser.dispatchEvent(Object.assign(new Event('storage'), { key }));
}
function clearStores() {
	ratingsStore.reset(true);
	planToReadStore.reset(true);
	notInterestedStore.reset(true);
	libraryLoads.reset();
}
beforeEach(() => {
	const data = new Map<string, string>();
	browser = Object.assign(new EventTarget(), {
		localStorage: {
			getItem: (key: string) => data.get(key) ?? null,
			setItem: (key: string, value: string) => {
				data.set(key, value);
			},
			removeItem: (key: string) => {
				data.delete(key);
			},
			key: (index: number) => [...data.keys()][index] ?? null,
			clear: () => data.clear(),
			get length() {
				return data.size;
			}
		}
	});
	vi.stubGlobal('window', browser);
	librarySaves.activateOwner(owner);
	librarySaves.discard();
	clearStores();
});
afterEach(() => {
	stop?.();
	stop = undefined;
	librarySaves.discard();
	ratingsStore.setPersistence(null);
	planToReadStore.setPersistence(null);
	notInterestedStore.setPersistence(null);
	clearStores();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('complete interaction snapshot restoration', () => {
	it('enables actions from complete collections, including exclusions and bookmark removal mappings', () => {
		complete();
		restoreLibrarySnapshot(owner);
		const state = get(userLibraryHydrationStore);
		for (const action of ['rating', 'bookmark', 'dismissal'] as const)
			expect(canUseLibraryAction(action, owner, state)).toBe(true);
		expect(get(ratingsStore.ratedBooks)[0]).toMatchObject({ book, rating: 4 });
		expect(notInterestedStore.has('dismissed-ulid')).toBe(true);
		planToReadStore.toggle('bookmark-uuid');
		expect(librarySaves.overlays('bookmark')[0]).toMatchObject({
			bookUlid: 'bookmark-ulid',
			value: false
		});
	});

	it('restores full rating IDs independently of missing card details', () => {
		writeLibrarySnapshot(owner, { ratings: { entries: [rating], books: [] }, dismissals: [] });
		restoreLibrarySnapshot(owner);
		expect(get(ratingsStore)).toEqual(new Map([[book.id, 4]]));
		expect(get(libraryLoads).collections.ratings.hasSnapshot).toBe(true);
		expect(get(libraryLoads).collections.ratedDetails.hasSnapshot).toBe(false);
		persistLibrarySnapshot(owner);
		expect(readLibrarySnapshot(owner).ratings?.entries).toEqual([
			{ id: book.id, book_id: book.book_id, rating: 4 }
		]);
	});

	it('restores complete empty collections as immediately actionable', () => {
		writeLibrarySnapshot(owner, {
			ratings: { entries: [], books: [] },
			bookmarks: [],
			dismissals: []
		});
		restoreLibrarySnapshot(owner);
		expect(get(userLibraryHydrationStore).idsReady).toBe(true);
		expect(get(userLibraryHydrationStore).detailsReady).toBe(true);
	});

	it('keeps legacy display without treating a ratings-only detail subset as complete IDs', () => {
		writeLibraryCache(owner, [rating]);
		restoreLibrarySnapshot(owner);
		expect(get(ratingsStore.ratedBooks)).toHaveLength(1);
		expect(get(userLibraryHydrationStore).idsReady).toBe(false);
		persistLibrarySnapshot(owner);
		expect(readLibrarySnapshot(owner)).toEqual({});
	});

	it('keeps the existing per-action gates for a partial cache', () => {
		writeLibrarySnapshot(owner, { bookmarks: [], dismissals: [] });
		restoreLibrarySnapshot(owner);
		const state = get(userLibraryHydrationStore);
		expect(canUseLibraryAction('bookmark', owner, state)).toBe(true);
		expect(canUseLibraryAction('rating', owner, state)).toBe(false);
		expect(canUseLibraryAction('dismissal', owner, state)).toBe(false);
	});

	it('does not persist uninitialized empty stores over a good cache; confirmed empty replaces it', () => {
		complete();
		persistLibrarySnapshot(owner);
		expect(readLibrarySnapshot(owner).dismissals).toEqual(['dismissed-ulid']);
		libraryLoads.markSnapshot(owner, LIBRARY_ID_COLLECTIONS);
		persistLibrarySnapshot(owner);
		expect(readLibrarySnapshot(owner)).toEqual({
			ratings: { entries: [], books: [] },
			bookmarks: [],
			dismissals: []
		});
	});

	it('refuses to mark a collection complete when its UUID/ULID mapping is unavailable', () => {
		ratingsStore.hydrate([{ bookId: 'unresolved', rating: 5 }]);
		planToReadStore.hydrate(['unresolved']);
		libraryLoads.markSnapshot(owner, LIBRARY_ID_COLLECTIONS);
		persistLibrarySnapshot(owner);
		expect(readLibrarySnapshot(owner)).toEqual({ dismissals: [] });
	});

	it('keeps pending additions and removals over an older cache', () => {
		complete();
		ratingsStore.setRating(book.id, 5, book.book_id, book);
		planToReadStore.toggle('bookmark-uuid', 'bookmark-ulid');
		planToReadStore.toggle('bookmark-uuid', 'bookmark-ulid');
		notInterestedStore.add('new-dismissal');
		notInterestedStore.add('dismissed-ulid');
		notInterestedStore.remove('dismissed-ulid');
		restoreLibrarySnapshot(owner);
		expect(get(ratingsStore).get(book.id)).toBe(5);
		expect(planToReadStore.has('bookmark-uuid')).toBe(false);
		expect(notInterestedStore.getBookIds()).toEqual(['new-dismissal']);
		expect(get(librarySaves).queuedCount).toBe(4);
	});

	it('keeps recently acknowledged actions over an older cached snapshot', async () => {
		complete();
		ratingsStore.setPersistence({ set() {}, remove() {} });
		ratingsStore.setRating(book.id, 5, book.book_id, book);
		await librarySaves.flush();
		clearStores();
		restoreLibrarySnapshot(owner);
		expect(get(ratingsStore).get(book.id)).toBe(5);
		persistLibrarySnapshot(owner);
		expect(readLibrarySnapshot(owner).ratings?.entries[0].rating).toBe(5);
	});

	it('isolates account activation and ignores attempts to restore or persist another account', () => {
		complete();
		restoreLibrarySnapshot('snapshot-B');
		expect(get(ratingsStore).size).toBe(0);
		restoreLibrarySnapshot(owner);
		librarySaves.activateOwner('snapshot-B');
		persistLibrarySnapshot(owner);
		expect(readLibrarySnapshot(owner).ratings?.entries).toHaveLength(1);
		expect(get(ratingsStore).size).toBe(0);
		librarySaves.discard();
	});
});

describe('browser snapshot lifecycle', () => {
	it('revalidates only relevant cross-tab events without erasing local pending intent', async () => {
		complete();
		const refresh = vi.fn(async () => {
			libraryLoads.markSnapshot(owner, LIBRARY_ID_COLLECTIONS);
		});
		const controller = createLibrarySnapshotController(refresh);
		stop = controller.mount();
		controller.activate(owner);
		notInterestedStore.add('local-pending');
		storageEvent(LIBRARY_SNAPSHOT_PREFIX + 'snapshot-B');
		expect(refresh).not.toHaveBeenCalled();
		storageEvent(LIBRARY_SNAPSHOT_PREFIX + owner);
		await Promise.resolve();
		expect(refresh).toHaveBeenCalledOnce();
		expect(notInterestedStore.has('local-pending')).toBe(true);
		expect(get(librarySaves).queuedCount).toBe(1);
		storageEvent(null);
		await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
	});

	it('coalesces a burst of relevant storage events and preserves a newer external cache after failed revalidation', async () => {
		vi.useFakeTimers();
		complete();
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const refresh = vi.fn(async () => {
			libraryLoads.register(
				owner,
				'ratings',
				async () => {
					await held;
					throw Object.assign(new Error('Denied'), { status: 403 });
				},
				1,
				() => true
			);
			await libraryLoads.retry(['ratings']);
		});
		const controller = createLibrarySnapshotController(refresh);
		stop = controller.mount();
		controller.activate(owner);
		writeLibrarySnapshot(owner, { dismissals: ['remote-newer'] });
		storageEvent(LIBRARY_SNAPSHOT_PREFIX + owner);
		storageEvent(LIBRARY_SNAPSHOT_PREFIX + owner);
		storageEvent(LIBRARY_SNAPSHOT_PREFIX + owner);
		expect(refresh).toHaveBeenCalledTimes(1);
		notInterestedStore.add('pending-local');
		release();
		await vi.runAllTimersAsync();
		expect(refresh).toHaveBeenCalledTimes(2);
		controller.flush();
		expect(readLibrarySnapshot(owner).dismissals).toEqual(['remote-newer']);
		expect(notInterestedStore.has('pending-local')).toBe(true);
		expect(get(librarySaves).queuedCount).toBe(1);
	});

	it('flushes on pagehide, and a cancelled old-account timer cannot replace another account cache', async () => {
		vi.useFakeTimers();
		complete();
		const controller = createLibrarySnapshotController(async () => {});
		stop = controller.mount();
		controller.activate(owner);
		notInterestedStore.add('local-pending');
		browser.dispatchEvent(new Event('pagehide'));
		expect(readLibrarySnapshot(owner).dismissals).toContain('local-pending');
		controller.activate(null);
		librarySaves.activateOwner('snapshot-B');
		await vi.advanceTimersByTimeAsync(300);
		expect(readLibrarySnapshot('snapshot-B')).toEqual({});
		expect(readLibrarySnapshot(owner).dismissals).toContain('local-pending');
		librarySaves.discard();
	});
});
