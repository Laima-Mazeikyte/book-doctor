<script lang="ts">
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Button from '$lib/components/Button.svelte';
	import ShortlistCarousel from '$lib/components/shortlist/ShortlistCarousel.svelte';
	import ShortlistError from '$lib/components/shortlist/ShortlistError.svelte';
	import ShortlistLoading from '$lib/components/shortlist/ShortlistLoading.svelte';
	import ShortlistTimedOut from '$lib/components/shortlist/ShortlistTimedOut.svelte';
	import {
		fetchRecommendations,
		RECOMMENDATIONS_POLL_INTERVAL_MS,
		RECOMMENDATIONS_POLL_TIMEOUT_MS
	} from '$lib/recommendations/fetchRecommendations';
	import { requestRecommendations } from '$lib/recommendations/requestRecommendations';
	import { refreshRecommendationsCountFromApi } from '$lib/stores/recommendationsCount';
	import { authStore } from '$lib/stores/auth';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import { recommendationsPageStore } from '$lib/stores/recommendationsPage';
	import { t } from '$lib/copy';
	import { X } from 'lucide-svelte';
	import type { Book, RatingValue } from '$lib/types/book';

	type ViewState = 'loading' | 'ready' | 'timedOut' | 'error' | 'empty';

	let books = $state<Book[]>([]);
	let viewState = $state<ViewState>('loading');
	let error = $state<string | null>(null);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let activeLoadId = 0;
	let activeIndex = $state(0);
	let requestingRecommendations = $state(false);

	function isActiveLoad(loadId: number, requestId: string | null): boolean {
		return (
			loadId === activeLoadId &&
			(page.url.searchParams.get('request_id')?.trim() ?? null) === requestId
		);
	}

	function handleNotInterested(book: Book) {
		const bid = book.book_id;
		const wasNotInterested = notInterestedStore.has(bid);
		const nowNotInterested = notInterestedStore.toggle(bid);
		if (nowNotInterested && !wasNotInterested) {
			if (planToReadStore.has(book.id)) {
				planToReadStore.toggle(book.id, book.book_id);
			}
			if (get(ratingsStore).has(book.id)) {
				ratingsStore.removeRating(book.id, book.book_id);
			}
		}
	}

	function handleBookmark(book: Book) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(book.id, book.book_id);
		if (!wasBookmarked) {
			notInterestedStore.remove(book.book_id);
		}
	}

	function handleRate(book: Book, value: RatingValue) {
		ratingsStore.setRating(book.id, value, book.book_id, book);
	}

	function handleRemoveRating(book: Book) {
		ratingsStore.removeRating(book.id, book.book_id);
	}

	async function handleRequestNewRecommendations() {
		if (requestingRecommendations) return;
		requestingRecommendations = true;
		try {
			await notInterestedStore.flushPending();
			await requestRecommendations($authStore.user?.id);
		} finally {
			requestingRecommendations = false;
		}
	}

	const showNewRecommendationsCta = $derived.by(() => {
		if (viewState !== 'ready' || books.length === 0) return false;
		const book = books[activeIndex];
		return book != null && $notInterestedStore.has(book.book_id);
	});

	function startPoll(accessToken: string | null, requestId: string, loadId: number) {
		const fromHistory = page.url.searchParams.get('from') === 'history';
		const cached = recommendationsPageStore.getRunBooks(requestId);

		if (fromHistory && cached && cached.length > 0) {
			books = [...cached];
			viewState = 'ready';
			void refreshRecommendationsCountFromApi(accessToken);
			void fetchRecommendations(accessToken, requestId)
				.then(({ books: next }) => {
					if (!isActiveLoad(loadId, requestId)) return;
					books = next;
					recommendationsPageStore.setRunBooks(requestId, next);
					viewState = next.length > 0 ? 'ready' : 'empty';
				})
				.catch(() => {
					/* keep cache */
				});
			return;
		}

		if (fromHistory && cached) {
			books = [];
			viewState = 'loading';
		} else if (!fromHistory) {
			books = [];
			viewState = 'loading';
		}

		const start = Date.now();

		const schedule = async () => {
			if (!isActiveLoad(loadId, requestId)) return;
			let done = false;
			try {
				const { books: nextBooks } = await fetchRecommendations(accessToken, requestId);
				if (!isActiveLoad(loadId, requestId)) return;
				if (nextBooks.length > 0) {
					books = nextBooks;
					recommendationsPageStore.setRunBooks(requestId, nextBooks);
					viewState = 'ready';
					void refreshRecommendationsCountFromApi(accessToken);
					done = true;
				} else if (Date.now() - start >= RECOMMENDATIONS_POLL_TIMEOUT_MS) {
					viewState = 'timedOut';
					done = true;
				}
			} catch (e) {
				if (!isActiveLoad(loadId, requestId)) return;
				error = e instanceof Error ? e.message : t('recommendations.failedToLoad');
				viewState = 'error';
				done = true;
			}

			if (!isActiveLoad(loadId, requestId)) return;
			if (done) {
				if (pollTimer != null) {
					clearTimeout(pollTimer);
					pollTimer = null;
				}
			} else {
				pollTimer = setTimeout(schedule, RECOMMENDATIONS_POLL_INTERVAL_MS);
			}
		};

		void schedule();
	}

	function retryLoad() {
		const requestId = page.url.searchParams.get('request_id')?.trim() ?? null;
		if (!requestId) return;
		const loadId = ++activeLoadId;
		error = null;
		viewState = 'loading';
		books = [];
		startPoll($authStore.session?.access_token ?? null, requestId, loadId);
	}

	$effect(() => {
		if (viewState === 'loading') {
			activeIndex = 0;
		}
	});

	$effect(() => {
		if (!browser) return;
		const requestId = page.url.searchParams.get('request_id')?.trim() ?? null;

		if (pollTimer != null) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}

		if (!requestId) {
			void goto('/rate/recommendations', { replaceState: true });
			return;
		}

		const loadId = ++activeLoadId;
		const accessToken = $authStore.session?.access_token ?? null;
		startPoll(accessToken, requestId, loadId);

		return () => {
			if (pollTimer != null) {
				clearTimeout(pollTimer);
				pollTimer = null;
			}
		};
	});

	const backHref = '/rate/recommendations';

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
		<div class="shortlist-page__heading">
			<h1 class="shortlist-page__title typ-display2 typ-display2--content">
				{t('recommendations.shortlist.title')}
			</h1>
			<p class="shortlist-page__description">{t('recommendations.shortlist.description')}</p>
		</div>
	</header>

	{#if viewState === 'loading'}
		<ShortlistLoading />
	{:else if viewState === 'timedOut'}
		<ShortlistTimedOut onRetry={retryLoad} />
	{:else if viewState === 'error'}
		<ShortlistError message={error} onRetry={retryLoad} />
	{:else if viewState === 'empty'}
		<div class="shortlist-page__empty typ-body">{t('recommendations.emptyRun')}</div>
	{:else}
		<ShortlistCarousel
			{books}
			bind:activeIndex
			getBookmarked={(id) => $planToReadStore.has(id)}
			getNotInterested={(bookId) => $notInterestedStore.has(bookId)}
			getRating={(id) => $ratingsStore.get(id) ?? null}
			onBookmark={handleBookmark}
			onNotInterested={handleNotInterested}
			onRate={handleRate}
			onRemoveRating={handleRemoveRating}
		/>
	{/if}

	{#if showNewRecommendationsCta}
		<div class="shortlist-page__new-rec-cta">
			<Button
				variant="primary"
				pill
				disabled={requestingRecommendations}
				aria-busy={requestingRecommendations ? 'true' : undefined}
				onclick={() => void handleRequestNewRecommendations()}
			>
				{t('rate.getRecommendations')}
			</Button>
		</div>
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
		padding: calc(var(--space-4) + env(safe-area-inset-top, 0px)) var(--space-4) var(--space-3);
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
	.shortlist-page__heading {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 100%;
		padding-top: calc(var(--min-tap) - var(--space-4));
	}
	.shortlist-page__title {
		display: flex;
		flex-direction: column;
		gap: 0;
		margin: 0;
		width: 100%;
		text-align: center;
	}
	.shortlist-page__description {
		display: flex;
		flex-direction: column;
		margin: 0;
		width: 100%;
		text-align: center;
		color: var(--color-text-muted);
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
	}
	.shortlist-page__empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-8) var(--space-4);
		color: var(--color-text-muted);
		text-align: center;
	}
	.shortlist-page__new-rec-cta {
		position: fixed;
		right: var(--space-4);
		bottom: calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
		z-index: 110;
		display: flex;
		justify-content: flex-end;
		pointer-events: none;
	}
	.shortlist-page__new-rec-cta :global(.btn) {
		pointer-events: auto;
	}
	@media (min-width: 768px) {
		.shortlist-page__new-rec-cta {
			bottom: calc(
				var(--space-3) + var(--space-4) + var(--space-4) + 4.5rem * 1.28 + var(--space-3) +
					env(safe-area-inset-bottom, 0px)
			);
		}
	}
</style>
