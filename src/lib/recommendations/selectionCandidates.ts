import { get, writable } from 'svelte/store';
import { resolve } from '$app/paths';
import { authStore } from '$lib/stores/auth';
import { librarySaves } from '$lib/stores/librarySaves';
import { recommendationsPageStore } from '$lib/stores/recommendationsPage';
import { withTimeout } from '$lib/requests/timeout';
import type { Book } from '$lib/types/book';

export type SelectionCandidates = { books: Book[]; lastRecommendedAt: Record<string, number> };
export type SelectionCandidatesState = SelectionCandidates & {
	owner: string | null;
	loaded: boolean;
	loading: boolean;
	stale: boolean;
	error: string;
};
const empty = (owner: string | null): SelectionCandidatesState => ({
	owner,
	books: [],
	lastRecommendedAt: {},
	loaded: false,
	loading: false,
	stale: false,
	error: ''
});

/** Account-scoped, shared reads. Invalidation cancels transport before any late commit. */
export function createSelectionCandidatesController(
	read: (owner: string, signal: AbortSignal) => Promise<SelectionCandidates>
) {
	const state = writable(empty(null));
	let revision = 0;
	let loadedAt = 0;
	let job: { controller: AbortController; promise: Promise<void> } | null = null;
	function cancel() {
		revision++;
		job?.controller.abort();
		job = null;
	}
	return {
		subscribe: state.subscribe,
		activate(owner: string | null) {
			if (get(state).owner === owner) return;
			cancel();
			loadedAt = 0;
			state.set(empty(owner));
		},
		invalidate() {
			cancel();
			state.update((value) => ({ ...value, stale: true, loading: false, error: '' }));
		},
		seed(owner: string, payload: SelectionCandidates) {
			if (get(state).owner !== owner) return;
			cancel();
			loadedAt = Date.now();
			state.set({
				...empty(owner),
				books: [...payload.books],
				lastRecommendedAt: payload.lastRecommendedAt,
				loaded: true
			});
		},
		load(owner: string, retry = false): Promise<void> {
			if (get(state).owner !== owner) this.activate(owner);
			if (job) return job.promise;
			const current = get(state);
			if (
				!retry &&
				((current.loaded && !current.stale && Date.now() - loadedAt < 60_000) || current.error)
			)
				return Promise.resolve();
			const controller = new AbortController();
			const version = revision;
			state.update((value) => ({ ...value, loading: true, error: '' }));
			const promise = withTimeout((signal) => read(owner, signal), { signal: controller.signal })
				.then((payload) => {
					if (version !== revision || controller.signal.aborted) return;
					loadedAt = Date.now();
					state.set({ ...empty(owner), ...payload, books: [...payload.books], loaded: true });
				})
				.catch(() => {
					if (version !== revision || controller.signal.aborted) return;
					state.update((value) => ({
						...value,
						loading: false,
						stale: false,
						error: 'Could not load previous recommendations.'
					}));
				})
				.finally(() => {
					if (job?.controller === controller) job = null;
				});
			job = { controller, promise };
			return promise;
		}
	};
}

export const selectionCandidates = createSelectionCandidatesController(async (owner, signal) => {
	// Revalidation must not snapshot exclusions before a local rating/dismissal is saved.
	await Promise.all([librarySaves.flush('rating'), librarySaves.flush('dismissal')]);
	signal.throwIfAborted();
	const auth = get(authStore);
	if (auth.user?.id !== owner || !auth.session?.access_token)
		throw new Error('Session unavailable');
	const response = await fetch(resolve('/api/recommendations/unique?view=selection'), {
		headers: { Authorization: `Bearer ${auth.session.access_token}` },
		signal
	});
	if (!response.ok) throw new Error('Could not load candidates');
	const payload = await response.json();
	if (!Array.isArray(payload.books)) throw new Error('Invalid candidates');
	return { books: payload.books, lastRecommendedAt: payload.lastRecommendedAt ?? {} };
});

let owner: string | null = null;
let libraryRevision = -1;
librarySaves.subscribe((snapshot) => {
	const next = snapshot.ownerId.startsWith('guest:') ? null : snapshot.ownerId;
	if (next !== owner) {
		owner = next;
		libraryRevision = librarySaves.getRevision();
		selectionCandidates.activate(owner);
	} else {
		const changes = [
			...librarySaves.overlays('rating', libraryRevision),
			...librarySaves.overlays('dismissal', libraryRevision)
		];
		const currentRevision = librarySaves.getRevision();
		if (currentRevision !== libraryRevision && changes.length) selectionCandidates.invalidate();
		libraryRevision = currentRevision;
	}
});
let fullLoaded = false;
recommendationsPageStore.subscribe((snapshot) => {
	if (snapshot.uniqueLoaded && owner) selectionCandidates.seed(owner, snapshot.unique);
	else if (fullLoaded) selectionCandidates.invalidate();
	fullLoaded = snapshot.uniqueLoaded;
});
