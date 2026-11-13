<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { get } from 'svelte/store';
	import { withTimeout, wait, RequestTimeoutError } from '$lib/requests/timeout';
	import LibraryLoadNotice from '$lib/components/LibraryLoadNotice.svelte';
	import RecommendationLoadNotice from '$lib/components/RecommendationLoadNotice.svelte';
	import ShortlistLoading from '$lib/components/shortlist/ShortlistLoading.svelte';
	import ShortlistError from '$lib/components/shortlist/ShortlistError.svelte';
	import ShortlistFailed from '$lib/components/shortlist/ShortlistFailed.svelte';
	import GroupedCarousel from '$lib/components/shortlist/GroupedCarousel.svelte';
	import RecommendationSubmissionNotice from '$lib/components/RecommendationSubmissionNotice.svelte';
	import {
		fetchRecommendations,
		RecommendationsHttpError,
		RECOMMENDATIONS_POLL_INTERVAL_MS,
		RECOMMENDATIONS_POLL_TIMEOUT_MS
	} from '$lib/recommendations/fetchRecommendations';
	import { hydrateFlavorGroups, parseFlavorGroups } from '$lib/recommendations/flavorGroups';
	import { createRecommendationSubmission } from '$lib/recommendations/requestRecommendations';
	import {
		recommendationsPageStore,
		type RecommendationRunData
	} from '$lib/stores/recommendationsPage';
	import { refreshRecommendationsCountFromApi } from '$lib/stores/recommendationsCount';
	import { authStore } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { planToReadStore } from '$lib/stores/planToRead';
	import {
		toggleBookmarked,
		toggleNotInterested,
		setBookRating,
		removeBookRating
	} from '$lib/stores/libraryActions';
	import {
		buildCleanLikedAuthorSet,
		filterAuthorRelationshipAuthors
	} from '$lib/recommendations/authorRelationships';
	import { filterRatedLikedBookPrecedents } from '$lib/recommendations/likedBookPrecedents';
	import { t } from '$lib/copy';
	import { X } from 'lucide-svelte';

	let run = $state<RecommendationRunData>({
		books: [],
		likedBookPrecedentsByBookId: {},
		authorRelationshipAuthorsByBookId: {},
		dimensionMatchSnapshotsByBookId: {}
	});
	const groups = $derived(
		run.flavor_groups ? hydrateFlavorGroups(run.flavor_groups, run.books) : []
	);
	let viewState = $state<'loading' | 'ready' | 'failed' | 'backend-failed' | 'error'>('loading');
	let error = $state<string | null>(null);
	let slowLoading = $state(false);
	let activeIndex = $state(0);
	let generation = 0;
	let loadController: AbortController | null = null;
	const recommendationSubmission = createRecommendationSubmission();
	beforeNavigate(({ to }) => recommendationSubmission.leave(to?.url ?? null));
	onDestroy(() => {
		recommendationSubmission.destroy();
		loadController?.abort();
	});
	const ratedBooksStore = ratingsStore.ratedBooks;
	const cleanLikedAuthorNames = $derived(buildCleanLikedAuthorSet($ratedBooksStore));
	const authorRelationshipAuthorsForDisplay = $derived(
		Object.fromEntries(
			Object.entries(run.authorRelationshipAuthorsByBookId).map(([id, authors]) => [
				id,
				filterAuthorRelationshipAuthors(authors, cleanLikedAuthorNames)
			])
		)
	);
	const likedBookPrecedentsForDisplay = $derived(
		Object.fromEntries(
			Object.entries(run.likedBookPrecedentsByBookId).map(([id, books]) => [
				id,
				filterRatedLikedBookPrecedents(books, $ratingsStore)
			])
		)
	);

	function startPoll(
		userId: string | null,
		token: string | null,
		requestId: string,
		preserve = false
	) {
		loadController?.abort();
		const controller = new AbortController();
		loadController = controller;
		const attempt = ++generation;
		const current = () =>
			!controller.signal.aborted &&
			attempt === generation &&
			get(authStore).user?.id === (userId ?? undefined);
		recommendationsPageStore.ensureUser(userId);
		const cached = recommendationsPageStore.getRun(requestId);
		if (cached?.flavor_groups && !preserve) run = cached;
		viewState = preserve || cached?.flavor_groups ? 'ready' : 'loading';
		if (viewState === 'loading') {
			run = {
				books: [],
				likedBookPrecedentsByBookId: {},
				authorRelationshipAuthorsByBookId: {},
				dimensionMatchSnapshotsByBookId: {}
			};
			activeIndex = 0;
		}
		error = null;
		slowLoading = false;
		const timer = setTimeout(() => {
			if (current()) slowLoading = true;
		}, 6000);
		void withTimeout(
			async (signal) => {
				while (current()) {
					const next = await fetchRecommendations(token, requestId, { signal });
					if (!current()) return;
					if (next.status === 'failed') {
						console.warn('[shortlist] Recommendation generation failed', {
							request_id: next.request_id,
							error_code: next.error_code
						});
						viewState = 'backend-failed';
						return;
					}
					if (next.flavor_groups) {
						const flavor_groups = parseFlavorGroups(next.flavor_groups);
						run = { ...next, flavor_groups };
						recommendationsPageStore.setRun(requestId, run);
						viewState = 'ready';
						void refreshRecommendationsCountFromApi(token);
						return;
					}
					if (next.status === 'completed') throw new Error('Missing grouped results');
					await wait(RECOMMENDATIONS_POLL_INTERVAL_MS, signal);
				}
			},
			{ signal: controller.signal, timeoutMs: RECOMMENDATIONS_POLL_TIMEOUT_MS }
		)
			.catch(async (cause) => {
				if (!current()) return;
				if (cause instanceof RecommendationsHttpError && cause.status === 404) {
					await invalidateAll();
					return;
				}
				error = t('recommendations.failedToLoad');
				if (viewState !== 'ready')
					viewState = cause instanceof RequestTimeoutError ? 'failed' : 'error';
			})
			.finally(() => clearTimeout(timer));
	}
	function retryLoad() {
		const id = page.url.searchParams.get('request_id')?.trim();
		if (id)
			startPoll(
				get(authStore).user?.id ?? null,
				get(authStore).session?.access_token ?? null,
				id,
				viewState === 'ready'
			);
	}
	$effect(() => {
		if (!browser) return;
		const id = page.url.searchParams.get('request_id')?.trim();
		const userId = $authStore.user?.id ?? null;
		if (!id) {
			void goto(resolve('/rate/recommendations'), { replaceState: true });
			return;
		}
		untrack(() => startPoll(userId, get(authStore).session?.access_token ?? null, id));
		return () => loadController?.abort();
	});
	const backHref = resolve('/rate/recommendations');
	function handleClose() {
		void goto(backHref);
	}
</script>

<svelte:head>
	<title>{t('recommendations.shortlist.title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('recommendations.shortlist.metaDescription')} />
</svelte:head>

<div class="shortlist-page">
	<header class="shortlist-page__header">
		<button
			type="button"
			class="shortlist-page__close"
			aria-label={t('recommendations.shortlist.close')}
			onclick={handleClose}
		>
			<X size={18} aria-hidden="true" />
		</button>
	</header>
	<RecommendationSubmissionNotice submission={recommendationSubmission} />

	<LibraryLoadNotice collections={['ratings', 'bookmarks', 'dismissals']} />
	{#if error && viewState === 'ready'}
		<RecommendationLoadNotice onRetry={retryLoad} />
	{/if}
	{#if viewState === 'loading'}
		<ShortlistLoading
			message={t(
				slowLoading ? 'recommendations.shortlist.takingLonger' : 'recommendations.shortlist.loading'
			)}
		/>
	{:else if viewState === 'backend-failed'}
		<ShortlistFailed
			kind="backend"
			busy={$recommendationSubmission.status === 'submitting'}
			onRetry={() => void recommendationSubmission.submit()}
		/>
	{:else if viewState === 'failed'}
		<ShortlistFailed onRetry={retryLoad} />
	{:else if viewState === 'error'}
		<ShortlistError onRetry={retryLoad} />
	{:else}
		<GroupedCarousel
			{groups}
			bind:activeIndex
			bookProps={(book, group) => ({
				bookmarked: $planToReadStore.has(book.id),
				likedBookPrecedents: likedBookPrecedentsForDisplay[book.book_id] ?? [],
				authorRelationshipAuthors: authorRelationshipAuthorsForDisplay[book.book_id] ?? [],
				dimensionMatches: run.dimensionMatchSnapshotsByBookId[book.book_id]?.matches ?? [],
				flavorEvidence: group.items.find((item) => item.book_id === book.book_id)?.flavor_evidence,
				flavorReferenceBook:
					run.flavorReferenceBooksById?.[
						String(
							group.items.find((item) => item.book_id === book.book_id)?.flavor_evidence
								?.reference_book_id ?? ''
						)
					],
				notInterested: $notInterestedStore.has(book.book_id),
				currentRating: $ratingsStore.get(book.id) ?? null,
				onBookmark: () => toggleBookmarked(book),
				onNotInterested: () => toggleNotInterested(book),
				onRate: (_id, value) => setBookRating(book, value),
				onRemoveRating: () => removeBookRating(book)
			})}
		/>
	{/if}
</div>

<style>
	.shortlist-page {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		width: 100%;
		height: 100%;
		background: var(--color-bg);
	}
	.shortlist-page__header {
		position: relative;
		flex-shrink: 0;
		min-height: calc(var(--min-tap) + var(--space-4) + env(safe-area-inset-top, 0px));
	}
	.shortlist-page__close {
		position: absolute;
		top: calc(var(--space-2) + env(safe-area-inset-top, 0px));
		right: calc(var(--space-2) + env(safe-area-inset-right, 0px));
		z-index: 11;
		width: var(--min-tap);
		height: var(--min-tap);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: transparent;
		border-radius: var(--radius-pill);
		cursor: pointer;
		color: var(--color-text);
		transition: background var(--duration-fast) var(--ease-default);
	}
	.shortlist-page__close:hover {
		background: var(--color-floating-control-bg);
	}
	.shortlist-page__close:hover:active {
		background: var(--color-floating-control-bg-hover);
	}
	.shortlist-page__close:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
