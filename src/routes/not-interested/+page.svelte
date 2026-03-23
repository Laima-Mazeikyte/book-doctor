<script lang="ts">
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import { recommendationsCountStore } from '$lib/stores/recommendationsCount';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardSkeleton from '$lib/components/BookCardSkeleton.svelte';
	import { t } from '$lib/copy';
	import type { Book } from '$lib/types/book';

	let books = $state<Book[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Refetch when visiting this page or when auth changes
	$effect(() => {
		const pathname = $page.url.pathname;
		const session = $authStore.session;
		const token = session?.access_token ?? null;
		if (pathname !== '/not-interested') return;
		if (!token) {
			loading = false;
			books = [];
			return;
		}
		loading = true;
		error = null;
		fetch('/api/not-interested/books', {
			headers: { Authorization: `Bearer ${token}` }
		})
			.then((res) => {
				if (!res.ok) throw new Error('Failed to load not interested');
				return res.json();
			})
			.then((data: { books: Book[] }) => {
				books = data.books ?? [];
			})
			.catch((e) => {
				error = e instanceof Error ? e.message : t('notInterested.empty');
				books = [];
			})
			.finally(() => {
				loading = false;
			});
	});

	function handleNotInterested(book: Book) {
		const wasNotInterested = notInterestedStore.has(book.book_id ?? 0);
		notInterestedStore.toggle(book.book_id ?? 0);
		if (wasNotInterested) {
			recommendationsCountStore.update((n) => n + 1);
		} else {
			recommendationsCountStore.update((n) => Math.max(0, n - 1));
		}
		// Remove from local list when user undoes "not interested"
		if (wasNotInterested) {
			books = books.filter((b) => b.book_id !== book.book_id);
		}
	}

	function handleBookmark(book: Book, id: string) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(id, book.book_id ?? 0);
		if (!wasBookmarked) {
			notInterestedStore.remove(book.book_id ?? 0);
			books = books.filter((b) => b.book_id !== book.book_id);
			recommendationsCountStore.update((n) => n + 1);
		}
	}
</script>

<div class="not-interested-page">
	<h1 class="not-interested-page__title typ-display2">{t('notInterested.title')}</h1>
	<p class="not-interested-page__intro">{t('notInterested.intro')}</p>
	{#if loading}
		<ul class="not-interested-page__list book-card-grid" aria-busy="true" aria-label={t('notInterested.title')}>
			{#each Array(6) as _}
				<li><BookCardSkeleton /></li>
			{/each}
		</ul>
	{:else if error}
		<p class="not-interested-page__error" role="alert">{error}</p>
	{:else if books.length === 0}
		<p class="not-interested-page__empty">{t('notInterested.empty')}</p>
	{:else}
		<ul class="not-interested-page__list book-card-grid" aria-label={t('notInterested.title')}>
			{#each books as book (book.id)}
				<li>
					<BookCard
						context="not-interested"
						{book}
						bookmarked={$planToReadStore.has(book.id)}
						onBookmark={(id) => handleBookmark(book, id)}
						currentRating={$ratingsStore.get(book.id) ?? null}
						onRate={(id, value) => ratingsStore.setRating(id, value, book.book_id ?? 0, book)}
						onRemoveRating={(id) => ratingsStore.removeRating(id, book.book_id ?? 0)}
						notInterested={true}
						onNotInterested={() => handleNotInterested(book)}
					/>
				</li>
			{/each}
		</ul>
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
	.not-interested-page__empty,
	.not-interested-page__error {
		color: var(--color-text-muted);
		margin: 0;
	}
	.not-interested-page__error {
		color: var(--color-error-text);
	}
	.not-interested-page__list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
</style>
