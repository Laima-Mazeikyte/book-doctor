import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { get, writable } from 'svelte/store';
import { getSupabase } from '$lib/supabase';
import { authStore } from '$lib/stores/auth';
import { librarySaves } from '$lib/stores/librarySaves';
import { isUserLibraryIdsReady, userLibraryHydrationStore } from '$lib/stores/userLibrary';

type SubmissionState = {
	status: 'idle' | 'submitting' | 'error';
	error: 'start' | 'open' | null;
};

/** One submission per mounted view. A confirmed request survives a failed navigation. */
export function createRecommendationSubmission() {
	const state = writable<SubmissionState>({ status: 'idle', error: null });
	let generation = 0;
	let requestId: string | null = null;
	let destination: string | null = null;
	let destroyed = false;
	let owner = get(authStore).user?.id;

	function cancel() {
		generation++;
		requestId = null;
		destination = null;
		state.set({ status: 'idle', error: null });
	}

	// Invalidate even an A -> B -> A switch; token refreshes keep the same owner.
	const unsubscribe = authStore.subscribe(({ user }) => {
		if (user?.id === owner) return;
		owner = user?.id;
		cancel();
	});

	return {
		subscribe: state.subscribe,
		async submit(): Promise<void> {
			if (destroyed || get(state).status === 'submitting') return;
			const attempt = ++generation;
			const userId = get(authStore).user?.id;
			const isCurrent = () =>
				!destroyed && attempt === generation && get(authStore).user?.id === userId;

			// This synchronous update closes the double-click window before the first await.
			state.set({ status: 'submitting', error: get(state).error });
			try {
				if (!userId) throw new Error('No active account.');
				if (!requestId) {
					await librarySaves.flush();
					if (!isCurrent()) return;
					if (!isUserLibraryIdsReady(userId, get(userLibraryHydrationStore))) {
						throw new Error('Load your library before getting recommendations.');
					}
					const supabase = getSupabase();
					if (!supabase) throw new Error('Recommendations are unavailable.');
					const { data, error } = await supabase
						.from('recommendation_requests')
						.insert({ user_id: userId })
						.select('id')
						.single();
					if (!isCurrent()) return;
					if (error || data?.id == null) throw error ?? new Error('No request ID returned.');
					requestId = String(data.id);
				}

				const target = resolve(
					`/rate/recommendations/shortlist?request_id=${encodeURIComponent(requestId)}`
				);
				destination = target;
				await goto(target);
				if (!isCurrent()) return;
				// Shortlist navigation can reuse the component with a new request_id.
				cancel();
			} catch {
				if (!isCurrent()) return;
				destination = null;
				state.set({ status: 'error', error: requestId ? 'open' : 'start' });
			}
		},
		/** Ignore our own navigation; leaving by another route invalidates pending responses. */
		leave(to: URL | null) {
			if (destination && to && `${to.pathname}${to.search}` === destination) return;
			cancel();
		},
		destroy() {
			destroyed = true;
			unsubscribe();
			cancel();
		}
	};
}

export type RecommendationSubmission = ReturnType<typeof createRecommendationSubmission>;
