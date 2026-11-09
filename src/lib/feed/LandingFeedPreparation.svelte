<script lang="ts">
	import { onMount } from 'svelte';
	import { readable } from 'svelte/store';
	import { preloadCode } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authReady, authStore } from '$lib/stores/auth';
	import { MAINTENANCE_ON } from '$lib/maintenance';
	import {
		shouldRequestInitialPersonalizedFeed,
		shouldShowLatestRateFeed
	} from '$lib/rate/feedEligibility';
	import { estimateGridColumns } from '$lib/components/book-card/coverPriority';
	import type { Book } from '$lib/types/book';
	import { getRateFeedContext } from './rateFeedContext';
	import { waitForLandingAssets } from './landingAssets';

	const controller = getRateFeedContext();
	const feed = controller ?? readable({ ownerId: null });
	const ownerId = $derived($feed.ownerId);
	let assetsReady = $state(false);
	let attemptedOwner: string | null | undefined;

	onMount(() => {
		if (MAINTENANCE_ON) return;
		const abort = new AbortController();
		void waitForLandingAssets(abort.signal).then(() => {
			if (abort.signal.aborted) return;
			assetsReady = true;
			void preloadCode(resolve('/rate')).catch(() => undefined);
		});
		return () => abort.abort();
	});

	function preloadCovers(books: Book[]) {
		for (const book of books.slice(0, estimateGridColumns())) {
			if (!book.coverUrl) continue;
			const image = new Image();
			image.decoding = 'async';
			image.fetchPriority = 'low';
			image.src = book.coverUrl;
		}
	}

	$effect(() => {
		const user = $authStore.user;
		const session = $authStore.session;
		const identity =
			user && session?.access_token ? { userId: user.id, accessToken: session.access_token } : null;
		if (
			MAINTENANCE_ON ||
			!assetsReady ||
			!$authReady ||
			!controller ||
			ownerId !== (identity?.userId ?? null)
		)
			return;
		if (attemptedOwner === ownerId) return;
		attemptedOwner = ownerId;
		// Reads survive navigation. Only speculative cover loading stops on unmount.
		let stopped = false;
		void (async () => {
			if (identity) {
				const payload = await controller.prepare(identity);
				if (stopped || !payload) return;
				if (shouldShowLatestRateFeed(payload)) {
					preloadCovers(payload.books);
					return;
				}
				// Generation remains an explicit rate-page operation.
				if (shouldRequestInitialPersonalizedFeed(payload)) return;
			}
			const popular = await controller.preparePopular(identity);
			if (!stopped && popular) preloadCovers(popular.books);
		})().catch(() => undefined);
		return () => {
			stopped = true;
		};
	});
</script>
