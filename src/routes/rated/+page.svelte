<script lang="ts">
	import { ratingsStore } from '$lib/stores/ratings';
	import { planToReadStore } from '$lib/stores/planToRead';
	import BookCard from '$lib/components/BookCard.svelte';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';

	// Snapshot of rated entries when the page is loaded; unrating does not remove from list until refresh
	let displayedEntries = $state<Array<{ book: Book; ratingAtLoad: RatingValue }>>([]);

	$effect(() => {
		if ($ratingsStore.size > 0 && displayedEntries.length === 0) {
			displayedEntries = Array.from($ratingsStore.entries())
				.map(([bookId, rating]) => {
					const book = ratingsStore.getRatedBook(bookId);
					return book ? { book, ratingAtLoad: rating } : null;
				})
				.filter((e): e is { book: Book; ratingAtLoad: RatingValue } => e !== null);
		}
	});
</script>

<div class="rated-page">
	<h1 class="rated-page__title typ-display2">{t('rated.title')}</h1>
	{#if displayedEntries.length === 0}
		<p class="rated-page__empty">{t('rated.empty')}</p>
	{:else}
		<ul class="rated-page__list book-card-grid" aria-label={t('shared.ratingsBar.yourRatings')}>
			{#each displayedEntries as { book, ratingAtLoad } (book.id)}
				<li>
					<BookCard
						context="rated"
						{book}
						bookmarked={$planToReadStore.has(book.id)}
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
	.rated-page {
		padding-bottom: var(--space-8);
	}
	.rated-page__title {
		margin: 0 0 var(--space-3) 0;
		text-align: center;
		font-size: 32px;
	}
	.rated-page__empty {
		color: var(--color-text-muted);
		margin: 0;
	}
	.rated-page__list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
</style>
