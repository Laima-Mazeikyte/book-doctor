<script lang="ts">
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
	import { refreshRecommendationsCountFromApi } from '$lib/stores/recommendationsCount';
	import { authStore } from '$lib/stores/auth';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import { recommendationsPageStore } from '$lib/stores/recommendationsPage';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';

	type ViewState = 'loading' | 'ready' | 'timedOut' | 'error' | 'empty';

	let books = $state<Book[]>([]);
	let viewState = $state<ViewState>('loading');
	let error = $state<string | null>(null);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let activeLoadId = 0;

	function isActiveLoad(loadId: number, requestId: string | null): boolean {
		return (
			loadId === activeLoadId &&
			(page.url.searchParams.get('request_id')?.trim() ?? null) === requestId
		);
	}

	function handleNotInterested(book: Book) {
		const bid = book.book_id;
		notInterestedStore.toggle(bid);
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

	const fromHistory = $derived(page.url.searchParams.get('from') === 'history');
	const backHref = $derived('/rate/recommendations');
	const backLabel = $derived(
		fromHistory ? t('recommendations.backToList') : t('recommendations.myRecommendations')
	);
</script>

<svelte:head>
	<title>{t('recommendations.shortlist.title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('recommendations.shortlist.metaDescription')} />
</svelte:head>

<div class="shortlist-page">
	<header class="shortlist-page__header">
		<Button variant="tertiary" compact href={backHref} aria-label={backLabel}>
			{backLabel}
		</Button>
		<h1 class="shortlist-page__title typ-display2 typ-display2--content">
			{t('recommendations.shortlist.title')}
		</h1>
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
			getBookmarked={(id) => $planToReadStore.has(id)}
			getNotInterested={(bookId) => $notInterestedStore.has(bookId)}
			getRating={(id) => $ratingsStore.get(id) ?? null}
			onBookmark={handleBookmark}
			onNotInterested={handleNotInterested}
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
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: calc(var(--space-4) + env(safe-area-inset-top, 0px)) var(--space-4) var(--space-3);
	}
	.shortlist-page__title {
		margin: 0;
		width: 100%;
		text-align: center;
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
</style>
