<script lang="ts">
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ShortlistCarousel from '$lib/components/shortlist/ShortlistCarousel.svelte';
	import {
		overlayForDismissedBook,
		insertBookAfterIndex,
		splitShortlistBooks,
		type NotInterestedOverlay
	} from '$lib/components/shortlist/shortlist-books';
	import ShortlistError from '$lib/components/shortlist/ShortlistError.svelte';
	import ShortlistLoading from '$lib/components/shortlist/ShortlistLoading.svelte';
	import ShortlistPositionIndicator from '$lib/components/shortlist/ShortlistPositionIndicator.svelte';
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

	let visibleBooks = $state<Book[]>([]);
	let reserveBooks = $state<Book[]>([]);
	let viewState = $state<ViewState>('loading');
	let error = $state<string | null>(null);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let activeLoadId = 0;
	let activeIndex = $state(0);
	let requestingRecommendations = $state(false);
	let sessionNiCount = $state(0);
	let insertionsUsed = $state(0);
	let insertedBookIds = $state<Set<string>>(new Set());
	let dismissalOrdinals = $state<Map<string, number>>(new Map());
	let replaceUsedBookIds = $state<Set<string>>(new Set());
	let scrollToBookIndex: ((index: number) => void) | undefined;

	function resetShortlistSession() {
		sessionNiCount = 0;
		insertionsUsed = 0;
		insertedBookIds = new Set();
		dismissalOrdinals = new Map();
		replaceUsedBookIds = new Set();
	}

	function applyBooksFromRun(all: Book[]) {
		const { visible, reserve } = splitShortlistBooks(all);
		visibleBooks = visible;
		reserveBooks = reserve;
		resetShortlistSession();
	}

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
			sessionNiCount += 1;
			dismissalOrdinals = new Map(dismissalOrdinals).set(bid, sessionNiCount);
			if (planToReadStore.has(book.id)) {
				planToReadStore.toggle(book.id, book.book_id);
			}
			if (get(ratingsStore).has(book.id)) {
				ratingsStore.removeRating(book.id, book.book_id);
			}
		} else if (wasNotInterested && !nowNotInterested) {
			if (!insertedBookIds.has(bid)) {
				sessionNiCount = Math.max(0, sessionNiCount - 1);
			}
			const next = new Map(dismissalOrdinals);
			next.delete(bid);
			dismissalOrdinals = next;
			const nextReplaceUsed = new Set(replaceUsedBookIds);
			nextReplaceUsed.delete(bid);
			replaceUsedBookIds = nextReplaceUsed;
		}
	}

	function handleBookmark(book: Book) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(book.id, book.book_id);
		if (!wasBookmarked) {
			const bid = book.book_id;
			if (notInterestedStore.has(bid)) {
				notInterestedStore.remove(bid);
				if (!insertedBookIds.has(bid)) {
					sessionNiCount = Math.max(0, sessionNiCount - 1);
				}
				const next = new Map(dismissalOrdinals);
				next.delete(bid);
				dismissalOrdinals = next;
				const nextReplaceUsed = new Set(replaceUsedBookIds);
				nextReplaceUsed.delete(bid);
				replaceUsedBookIds = nextReplaceUsed;
			}
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

	function getNotInterestedOverlay(bookId: string): NotInterestedOverlay {
		if (!$notInterestedStore.has(bookId)) return null;
		return overlayForDismissedBook(
			dismissalOrdinals.get(bookId),
			reserveBooks.length,
			insertionsUsed,
			sessionNiCount,
			replaceUsedBookIds.has(bookId)
		);
	}

	function handleOfferAnotherBook(book: Book, index: number) {
		const result = insertBookAfterIndex(visibleBooks, index, reserveBooks);
		if (!result.incoming) return;
		visibleBooks = result.visible;
		reserveBooks = result.reserve;
		insertionsUsed += 1;
		insertedBookIds = new Set(insertedBookIds).add(result.incoming.book_id);
		replaceUsedBookIds = new Set(replaceUsedBookIds).add(book.book_id);
		const nextIndex = index + 1;
		activeIndex = nextIndex;
		queueMicrotask(() => scrollToBookIndex?.(nextIndex));
	}

	function startPoll(accessToken: string | null, requestId: string, loadId: number) {
		const fromHistory = page.url.searchParams.get('from') === 'history';
		const cached = recommendationsPageStore.getRunBooks(requestId);

		if (fromHistory && cached && cached.length > 0) {
			applyBooksFromRun(cached);
			viewState = 'ready';
			void refreshRecommendationsCountFromApi(accessToken);
			void fetchRecommendations(accessToken, requestId)
				.then(({ books: next }) => {
					if (!isActiveLoad(loadId, requestId)) return;
					applyBooksFromRun(next);
					recommendationsPageStore.setRunBooks(requestId, next);
					viewState = next.length > 0 ? 'ready' : 'empty';
				})
				.catch(() => {
					/* keep cache */
				});
			return;
		}

		if (fromHistory && cached) {
			visibleBooks = [];
			reserveBooks = [];
			viewState = 'loading';
		} else if (!fromHistory) {
			visibleBooks = [];
			reserveBooks = [];
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
					applyBooksFromRun(nextBooks);
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
		visibleBooks = [];
		reserveBooks = [];
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

		const userId = $authStore.user?.id ?? null;
		const loadId = ++activeLoadId;
		const accessToken = get(authStore).session?.access_token ?? null;
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
			{#if viewState === 'ready' && visibleBooks.length > 1}
				<div class="shortlist-page__position">
					<ShortlistPositionIndicator
						position={activeIndex + 1}
						total={visibleBooks.length}
					/>
				</div>
			{/if}
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
			books={visibleBooks}
			bind:activeIndex
			registerScrollController={(controller) => {
				scrollToBookIndex = controller.scrollToIndex;
			}}
			getBookmarked={(id) => $planToReadStore.has(id)}
			getNotInterested={(bookId) => $notInterestedStore.has(bookId)}
			getNotInterestedOverlay={getNotInterestedOverlay}
			getRating={(id) => $ratingsStore.get(id) ?? null}
			onBookmark={handleBookmark}
			onNotInterested={handleNotInterested}
			onOfferAnotherBook={handleOfferAnotherBook}
			onRequestNewRecommendations={handleRequestNewRecommendations}
			{requestingRecommendations}
			onRate={handleRate}
			onRemoveRating={handleRemoveRating}
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
		padding: calc(var(--space-4) + env(safe-area-inset-top, 0px)) var(--space-6) var(--space-3);
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
		padding-top: 0;
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
		padding-inline: var(--space-6);
		text-align: center;
		color: var(--color-text-muted);
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
	}
	.shortlist-page__position {
		display: none;
		justify-content: center;
		width: 100%;
		padding-top: var(--space-1);
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

	@media (max-width: 767px) {
		.shortlist-page__header {
			padding-bottom: var(--space-2);
		}
		.shortlist-page__title {
			font-size: 1.5rem;
			line-height: var(--primitive-line-height-display);
		}
		.shortlist-page__position {
			display: flex;
		}
	}
</style>
