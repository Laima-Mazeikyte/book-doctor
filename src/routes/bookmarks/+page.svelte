<script lang="ts">
	import { authStore } from '$lib/stores/auth';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import RecommendationCard from '$lib/components/RecommendationCard.svelte';
	import { t } from '$lib/copy';
	import type { Book } from '$lib/types/book';

	let books = $state<Book[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	$effect(() => {
		const session = $authStore.session;
		const token = session?.access_token ?? null;
		if (!token) {
			loading = false;
			books = [];
			return;
		}
		loading = true;
		error = null;
		fetch('/api/bookmarks', {
			headers: { Authorization: `Bearer ${token}` }
		})
			.then((res) => {
				if (!res.ok) throw new Error('Failed to load bookmarks');
				return res.json();
			})
			.then((data: { books: Book[] }) => {
				books = data.books ?? [];
			})
			.catch((e) => {
				error = e instanceof Error ? e.message : t('bookmarks.empty');
				books = [];
			})
			.finally(() => {
				loading = false;
			});
	});
</script>

<div class="bookmarks-page">
	<h1 class="bookmarks-page__title">{t('bookmarks.title')}</h1>
	{#if loading}
		<p class="bookmarks-page__muted">{t('shared.recommendationsLoading.message')}</p>
	{:else if error}
		<p class="bookmarks-page__error" role="alert">{error}</p>
	{:else if books.length === 0}
		<p class="bookmarks-page__empty">{t('bookmarks.empty')}</p>
	{:else}
		<ul class="bookmarks-page__list book-card-grid" aria-label={t('shared.recommendationCard.bookmark')}>
			{#each books as book (book.id)}
				<li>
					<RecommendationCard
						{book}
						bookmarked={true}
						onBookmark={(id) => planToReadStore.toggle(id, book.book_id)}
						currentRating={$ratingsStore.get(book.id) ?? null}
						onRate={(id, value) => ratingsStore.setRating(id, value, book.book_id, book)}
						onRemoveRating={(id) => ratingsStore.removeRating(id, book.book_id)}
					/>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.bookmarks-page {
		padding-bottom: var(--space-8);
	}
	.bookmarks-page__title {
		font-size: var(--font-size-2xl);
		margin: 0 0 var(--space-4) 0;
	}
	.bookmarks-page__muted,
	.bookmarks-page__empty,
	.bookmarks-page__error {
		color: var(--color-text-muted);
		margin: 0;
	}
	.bookmarks-page__error {
		color: var(--color-error, #c00);
	}
	.bookmarks-page__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-4);
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	}
</style>
