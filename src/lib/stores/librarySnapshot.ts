import { get } from 'svelte/store';
import {
	isLibraryCacheEvent,
	readLibraryCache,
	readLibrarySnapshot,
	writeLibrarySnapshot,
	type LibrarySnapshotCollections
} from './libraryCache';
import { libraryLoads } from './libraryLoads';
import { librarySaves } from './librarySaves';
import { notInterestedStore } from './notInterested';
import { planToReadStore } from './planToRead';
import { ratingsStore } from './ratings';
import { LIBRARY_ID_COLLECTIONS } from './userLibrary';

/** Restore through the existing stores; journal overlays remain the source of pending intent. */
export function restoreLibrarySnapshot(userId: string): void {
	if (librarySaves.getOwner() !== userId) return;
	const cached = readLibrarySnapshot(userId);
	if (cached.ratings) {
		const { entries, books } = cached.ratings;
		ratingsStore.hydrateFromCache(books);
		ratingsStore.hydrate(
			entries.map((row) => ({ bookId: row.id, rating: row.rating })),
			-1,
			new Map(entries.map((row) => [row.id, row.book_id]))
		);
		libraryLoads.markSnapshot(userId, ['ratings']);
		if (books.length === entries.length) libraryLoads.markSnapshot(userId, ['ratedDetails']);
	} else {
		// V1 was written from available details, possibly a subset of the IDs.
		// Keep its display benefit without claiming a complete interaction collection.
		const legacy = readLibraryCache(userId);
		if (legacy?.length) {
			ratingsStore.hydrateFromCache(legacy);
			libraryLoads.markSnapshot(userId, ['ratedDetails']);
		}
	}
	if (cached.bookmarks) {
		planToReadStore.hydrate(
			cached.bookmarks.map((row) => row.id),
			new Map(cached.bookmarks.map((row) => [row.id, row.book_id])),
			-1
		);
		libraryLoads.markSnapshot(userId, ['bookmarks']);
	}
	if (cached.dismissals) {
		notInterestedStore.hydrate(cached.dismissals, -1);
		libraryLoads.markSnapshot(userId, ['dismissals']);
	}
}

export function persistLibrarySnapshot(userId: string): void {
	const loads = get(libraryLoads);
	if (librarySaves.getOwner() !== userId || loads.userId !== userId) return;
	const patch: LibrarySnapshotCollections = {};
	if (loads.collections.ratings.hasSnapshot) {
		const ratings = ratingsStore.getSnapshot();
		if (ratings) patch.ratings = ratings;
	}
	if (loads.collections.bookmarks.hasSnapshot) {
		const bookmarks = planToReadStore.getSnapshot();
		if (bookmarks) patch.bookmarks = bookmarks;
	}
	if (loads.collections.dismissals.hasSnapshot) patch.dismissals = notInterestedStore.getBookIds();
	writeLibrarySnapshot(userId, patch);
}

/** Browser lifecycle belongs to a layout instance, never to a shared SSR singleton. */
export function createLibrarySnapshotController(refresh: () => Promise<void>, delayMs = 200) {
	let owner: string | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let restoring = false;
	let pausedForExternalChange = false;
	let generation = 0;
	let externalRefresh: { generation: number; again: boolean } | null = null;
	function flush() {
		clearTimeout(timer);
		timer = undefined;
		if (owner && !restoring && !pausedForExternalChange) persistLibrarySnapshot(owner);
	}
	function schedule() {
		if (!owner || restoring) return;
		if (pausedForExternalChange) {
			if (externalRefresh) return;
			const loads = get(libraryLoads);
			if (
				loads.userId !== owner ||
				!LIBRARY_ID_COLLECTIONS.every((kind) => loads.collections[kind].status === 'ready')
			)
				return;
			pausedForExternalChange = false;
		}
		// Bounded delay: later updates do not indefinitely postpone persistence.
		if (!timer) timer = setTimeout(flush, delayMs);
	}
	return {
		activate(userId: string | null) {
			if (userId === owner) return;
			clearTimeout(timer);
			timer = undefined;
			generation++;
			externalRefresh = null;
			owner = userId;
			pausedForExternalChange = false;
			restoring = true;
			if (userId) restoreLibrarySnapshot(userId);
			restoring = false;
			schedule();
		},
		flush,
		mount() {
			const subscriptions = [
				ratingsStore,
				ratingsStore.ratedBooksDetails,
				planToReadStore,
				notInterestedStore,
				librarySaves,
				libraryLoads
			].map((store) => store.subscribe(schedule));
			const onStorage = (event: StorageEvent) => {
				if (!owner || !isLibraryCacheEvent(event.key, owner)) return;
				try {
					if (event.storageArea && event.storageArea !== window.localStorage) return;
				} catch {
					return;
				}
				clearTimeout(timer);
				timer = undefined;
				pausedForExternalChange = true;
				if (externalRefresh) {
					externalRefresh.again = true;
					return;
				}
				const task = { generation, again: false };
				externalRefresh = task;
				// Revalidate rather than applying another tab's potentially older UI snapshot.
				// A burst joins the running read and schedules at most one follow-up per read.
				void (async () => {
					do {
						task.again = false;
						await refresh().catch(() => undefined);
					} while (task.generation === generation && task.again);
					if (externalRefresh !== task) return;
					externalRefresh = null;
					schedule();
				})();
			};
			window.addEventListener('storage', onStorage);
			window.addEventListener('pagehide', flush);
			return () => {
				flush();
				generation++;
				externalRefresh = null;
				owner = null;
				for (const unsubscribe of subscriptions) unsubscribe();
				window.removeEventListener('storage', onStorage);
				window.removeEventListener('pagehide', flush);
			};
		}
	};
}
