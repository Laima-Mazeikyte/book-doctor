import { get, writable } from 'svelte/store';

export interface UserLibraryHydrationState {
	userId: string | null;
	ready: boolean;
}

export const userLibraryHydrationStore = writable<UserLibraryHydrationState>({
	userId: null,
	ready: false
});

let hydrationWaiters = new Map<string, Array<() => void>>();

function notifyHydrationWaiters(userId: string): void {
	const waiters = hydrationWaiters.get(userId);
	if (!waiters) return;
	hydrationWaiters.delete(userId);
	for (const resolve of waiters) resolve();
}

/** Layout: user library load started for this Supabase user id. */
export function markUserLibraryHydrationStarted(userId: string): void {
	userLibraryHydrationStore.set({ userId, ready: false });
}

/** Layout: ratings, bookmarks, and not-interested hydration finished for this user. */
export function markUserLibraryHydrationReady(userId: string): void {
	userLibraryHydrationStore.set({ userId, ready: true });
	notifyHydrationWaiters(userId);
}

/** Layout: no signed-in user — nothing to hydrate. */
export function clearUserLibraryHydration(): void {
	userLibraryHydrationStore.set({ userId: null, ready: true });
}

/**
 * Resolves when the layout has finished hydrating library stores for `userId`.
 * Resolves immediately when `userId` is null (fresh / signed-out after restore).
 */
export function waitForUserLibraryHydration(userId: string | null): Promise<void> {
	if (!userId) return Promise.resolve();
	const state = get(userLibraryHydrationStore);
	if (state.userId === userId && state.ready) return Promise.resolve();
	return new Promise((resolve) => {
		const waiters = hydrationWaiters.get(userId) ?? [];
		waiters.push(resolve);
		hydrationWaiters.set(userId, waiters);
	});
}
