import { derived } from 'svelte/store';
import { libraryLoads, type LibraryCollection, type LibraryLoadSnapshot } from './libraryLoads';
import { librarySaves } from './librarySaves';

export const LIBRARY_ID_COLLECTIONS = ['ratings', 'bookmarks', 'dismissals'] as const;
export interface UserLibraryHydrationState extends LibraryLoadSnapshot {
	idsReady: boolean;
	detailsReady: boolean;
}
export const userLibraryHydrationStore = derived(
	libraryLoads,
	(state): UserLibraryHydrationState => ({
		...state,
		idsReady:
			!state.userId || LIBRARY_ID_COLLECTIONS.every((kind) => state.collections[kind].hasSnapshot),
		detailsReady: !state.userId || state.collections.ratedDetails.hasSnapshot
	})
);

// Account changes invalidate reads immediately, before the layout's next reactive pass.
librarySaves.subscribe(({ ownerId }) => {
	libraryLoads.activate(ownerId.startsWith('guest:') ? null : ownerId);
});

let idsLoader: ((userId: string) => void) | null = null;
let detailsLoader: ((userId: string) => void) | null = null;

export function markUserLibraryIdsStarted(userId: string): void {
	libraryLoads.activate(userId);
}

/** Used when a complete, successful ID snapshot is already available. */
export function markUserLibraryIdsReady(userId: string): void {
	libraryLoads.markSnapshot(userId, LIBRARY_ID_COLLECTIONS);
	scheduleUserLibraryDetailsLoad(userId);
}

export function markUserLibraryDetailsReady(userId: string): void {
	libraryLoads.markSnapshot(userId, ['ratedDetails']);
}

export function clearUserLibraryHydration(): void {
	libraryLoads.reset();
}

export function areLibraryCollectionsAvailable(
	userId: string | null | undefined,
	hydration: UserLibraryHydrationState,
	kinds: readonly LibraryCollection[]
): boolean {
	return (
		!userId ||
		(hydration.userId === userId && kinds.every((kind) => hydration.collections[kind].hasSnapshot))
	);
}

export function isUserLibraryIdsReady(
	userId: string | null | undefined,
	hydration: UserLibraryHydrationState
): boolean {
	return areLibraryCollectionsAvailable(userId, hydration, LIBRARY_ID_COLLECTIONS);
}

export function isUserLibraryDetailsReady(
	userId: string | null | undefined,
	hydration: UserLibraryHydrationState
): boolean {
	return areLibraryCollectionsAvailable(userId, hydration, ['ratedDetails']);
}

export function canUseLibraryAction(
	action: 'rating' | 'bookmark' | 'dismissal',
	userId: string | null | undefined,
	hydration: UserLibraryHydrationState
): boolean {
	const needed: readonly LibraryCollection[] =
		action === 'rating'
			? ['ratings', 'dismissals']
			: action === 'bookmark'
				? ['bookmarks', 'dismissals']
				: LIBRARY_ID_COLLECTIONS;
	return areLibraryCollectionsAvailable(userId, hydration, needed);
}

export function registerUserLibraryIdsLoader(fn: (userId: string) => void): void {
	idsLoader = fn;
}
export function unregisterUserLibraryIdsLoader(): void {
	idsLoader = null;
}
export function registerUserLibraryDetailsLoader(fn: (userId: string) => void): void {
	detailsLoader = fn;
}
export function unregisterUserLibraryDetailsLoader(): void {
	detailsLoader = null;
}

function schedule(run: () => void) {
	if (typeof requestIdleCallback !== 'undefined') requestIdleCallback(run, { timeout: 3000 });
	else setTimeout(run, 0);
}
export function scheduleUserLibraryIdsLoad(userId: string | null | undefined): void {
	if (userId && idsLoader) schedule(() => idsLoader?.(userId));
}
export function scheduleUserLibraryDetailsLoad(userId: string | null | undefined): void {
	if (userId && detailsLoader) schedule(() => detailsLoader?.(userId));
}
