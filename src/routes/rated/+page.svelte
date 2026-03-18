<script lang="ts">
	import { ratingsStore } from '$lib/stores/ratings';
	import { planToReadStore } from '$lib/stores/planToRead';
	import RecommendationCard from '$lib/components/RecommendationCard.svelte';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';

	const ratedEntries = $derived(
		Array.from($ratingsStore.entries())
			.map(([bookId, rating]) => {
				const book = ratingsStore.getRatedBook(bookId);
				return book ? { book, rating } : null;
			})
			.filter((e): e is { book: Book; rating: RatingValue } => e !== null)
	);
</script>

<div class="rated-page">
	<h1 class="rated-page__title">{t('rated.title')}</h1>
	{#if ratedEntries.length === 0}
		<p class="rated-page__empty">{t('rated.empty')}</p>
	{:else}
		<ul class="rated-page__list book-card-grid" aria-label={t('shared.ratingsBar.yourRatings')}>
			{#each ratedEntries as { book, rating } (book.id)}
				<li>
					<RecommendationCard
						{book}
						bookmarked={$planToReadStore.has(book.id)}
						onBookmark={(id) => planToReadStore.toggle(id, book.book_id)}
						currentRating={rating}
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
		font-size: var(--font-size-2xl);
		margin: 0 0 var(--space-4) 0;
	}
	.rated-page__empty {
		color: var(--color-text-muted);
		margin: 0;
	}
	.rated-page__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-4);
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	}
</style>
