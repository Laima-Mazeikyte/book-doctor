import { writable } from 'svelte/store';

export interface UserLibraryHydrationState {
	userId: string | null;
	idsReady: boolean;
	detailsReady: boolean;
}

export const userLibraryHydrationStore = writable<UserLibraryHydrationState>({
	userId: null,
	idsReady: true,
	detailsReady: true
});

let idsLoader: ((userId: string) => void) | null = null;
let detailsLoader: ((userId: string) => void) | null = null;

/** Layout: lightweight library id load started for this Supabase user id. */
export function markUserLibraryIdsStarted(userId: string): void {
	userLibraryHydrationStore.set({ userId, idsReady: false, detailsReady: false });
}

/** Layout: ratings, bookmarks, and not-interested id hydration finished for this user. */
export function markUserLibraryIdsReady(userId: string): void {
	userLibraryHydrationStore.update((state) =>
		state.userId === userId
			? { ...state, idsReady: true }
			: { userId, idsReady: true, detailsReady: false }
	);
	scheduleUserLibraryDetailsLoad(userId);
}

/** Layout: rated-book details hydration finished for this user. */
export function markUserLibraryDetailsReady(userId: string): void {
	userLibraryHydrationStore.update((state) =>
		state.userId === userId
			? { ...state, detailsReady: true }
			: { userId, idsReady: true, detailsReady: true }
	);
}

/** Layout: no signed-in user — nothing to hydrate. */
export function clearUserLibraryHydration(): void {
	userLibraryHydrationStore.set({ userId: null, idsReady: true, detailsReady: true });
}

/** True when rating/bookmark/not-interested ids are hydrated for the active user. */
export function isUserLibraryIdsReady(
	userId: string | null | undefined,
	hydration: UserLibraryHydrationState
): boolean {
	if (!userId) return true;
	if (hydration.userId !== userId) return false;
	return hydration.idsReady;
}

/** Layout registers the deferred library id loader. */
export function registerUserLibraryIdsLoader(fn: (userId: string) => void): void {
	idsLoader = fn;
}

export function unregisterUserLibraryIdsLoader(): void {
	idsLoader = null;
}

/** Schedule library id hydration after first paint / idle time (non-blocking). */
export function scheduleUserLibraryIdsLoad(userId: string | null | undefined): void {
	if (!userId || !idsLoader) return;
	const run = () => idsLoader?.(userId);
	if (typeof requestIdleCallback !== 'undefined') {
		requestIdleCallback(() => run(), { timeout: 3000 });
		return;
	}
	setTimeout(run, 0);
}

/** Layout registers the deferred rated-book details loader. */
export function registerUserLibraryDetailsLoader(fn: (userId: string) => void): void {
	detailsLoader = fn;
}

export function unregisterUserLibraryDetailsLoader(): void {
	detailsLoader = null;
}

/** Schedule rated-book details after first paint / idle time (non-blocking). */
export function scheduleUserLibraryDetailsLoad(userId: string | null | undefined): void {
	if (!userId || !detailsLoader) return;
	const run = () => detailsLoader?.(userId);
	if (typeof requestIdleCallback !== 'undefined') {
		requestIdleCallback(() => run(), { timeout: 3000 });
		return;
	}
	setTimeout(run, 0);
}
