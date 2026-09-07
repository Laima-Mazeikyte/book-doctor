<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import { refreshRecommendationsCountFromApi } from '$lib/stores/recommendationsCount';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardGridSkeleton from '$lib/components/BookCardGridSkeleton.svelte';
	import NotInterestedPagination from '$lib/components/NotInterestedPagination.svelte';
	import {
		coverPriorityFor,
		estimateGridColumns,
		trackGridColumns
	} from '$lib/components/book-card/coverPriority';
	import { t } from '$lib/copy';
	import { notInterestedPageLoader, notInterestedPageStore } from '$lib/notInterested/pageLoader';
	import type { Book, RatingValue } from '$lib/types/book';

	let gridColumns = $state(estimateGridColumns());
	const pageState = $derived($notInterestedPageStore.entries.newest);
	const books = $derived(pageState.books);
	const initialLoading = $derived(!pageState.loaded && !pageState.error);
	const standaloneScrollStorageKey = 'book-doctor:not-interested-scroll:newest';

	$effect(() => {
		const pathname = $page.url.pathname;
		const authKey = `${$authStore.user?.id ?? ''}:${$authStore.session?.access_token ?? ''}`;
		if (pathname !== '/not-interested') return;
		void authKey;
		void notInterestedPageLoader.ensureLoaded('newest');
	});

	onMount(() => {
		try {
			const saved = Number(sessionStorage.getItem(standaloneScrollStorageKey));
			if (Number.isFinite(saved) && saved > 0) {
				requestAnimationFrame(() => window.scrollTo({ top: saved, behavior: 'auto' }));
			}
		} catch {
			// ignore unavailable storage
		}
		return () => {
			try {
				sessionStorage.setItem(standaloneScrollStorageKey, String(window.scrollY));
			} catch {
				// ignore unavailable storage
			}
		};
	});

	function refreshRecommendationCount(): void {
		const token = $authStore.session?.access_token ?? null;
		if (token) {
			void notInterestedStore
				.flushPending()
				.catch(() => undefined)
				.then(() => refreshRecommendationsCountFromApi(token));
		}
	}

	function handleNotInterested(book: Book) {
		const wasNotInterested = notInterestedStore.has(book.book_id);
		notInterestedStore.toggle(book.book_id);
		if (wasNotInterested) {
			refreshRecommendationCount();
		}
	}

	function handleBookmark(book: Book, id: string) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(id, book.book_id);
		if (!wasBookmarked) {
			notInterestedStore.remove(book.book_id);
			refreshRecommendationCount();
		}
	}

	function handleRate(book: Book, id: string, value: RatingValue) {
		ratingsStore.setRating(id, value, book.book_id, book);
		refreshRecommendationCount();
	}
</script>

<svelte:head>
	<title>{t('notInterested.title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('notInterested.metaDescription')} />
</svelte:head>

<div class="not-interested-page">
	<h1 class="not-interested-page__title typ-display2">{t('notInterested.title')}</h1>
	<p class="not-interested-page__intro">{t('notInterested.intro')}</p>
	{#if initialLoading}
		<BookCardGridSkeleton class="not-interested-page__list" ariaLabel={t('notInterested.title')} />
	{:else if pageState.loaded && books.length === 0 && !pageState.nextCursor && !pageState.error}
		<p class="not-interested-page__empty">{t('notInterested.empty')}</p>
	{:else}
		<ul
			class="not-interested-page__list book-card-grid"
			aria-label={t('notInterested.title')}
			use:trackGridColumns={(c) => (gridColumns = c)}
		>
			{#each books as book, i (book.id)}
				<li>
					<BookCard
						context="not-interested"
						{book}
						coverPriority={coverPriorityFor(i, gridColumns)}
						bookmarked={$planToReadStore.has(book.id)}
						onBookmark={(id) => handleBookmark(book, id)}
						currentRating={$ratingsStore.get(book.id) ?? null}
						onRate={(id, value) => handleRate(book, id, value)}
						onRemoveRating={(id) => ratingsStore.removeRating(id, book.book_id)}
						notInterested={true}
						onNotInterested={() => handleNotInterested(book)}
					/>
				</li>
			{/each}
		</ul>
		<NotInterestedPagination state={pageState} order="newest" />
	{/if}
</div>

<style>
	.not-interested-page {
		padding-bottom: var(--space-8);
	}
	.not-interested-page__title {
		margin: 0 0 var(--space-2) 0;
	}
	.not-interested-page__intro {
		color: var(--color-text-muted);
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		margin: 0 0 var(--space-3) 0;
	}
	.not-interested-page__empty {
		color: var(--color-text-muted);
		margin: 0;
	}
	.not-interested-page__list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
</style>
