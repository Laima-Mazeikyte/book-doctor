<script lang="ts">
	import { ratingsStore } from '$lib/stores/ratings';
	import type { Book, RatingValue } from '$lib/types/book';

	interface Props {
		book: Book;
	}

	let { book }: Props = $props();

	let hoverRating = $state<number>(0);
	let coverImageFailed = $state(false);

	const showCoverImage = $derived(Boolean(book.coverUrl) && !coverImageFailed);

	const RATING_OPTIONS: RatingValue[] = [1, 2, 3, 4, 5];
	const STAR_FILLED = '★';
	const STAR_EMPTY = '☆';

	const currentRating = $derived($ratingsStore.get(book.id) ?? 0);
	const displayRating = $derived(hoverRating > 0 ? hoverRating : currentRating);
</script>

<article class="book-card" data-book-id={book.id}>
	<div class="book-card__media">
		{#if showCoverImage}
			<img
				src={book.coverUrl}
				alt=""
				class="book-card__cover"
				onerror={() => (coverImageFailed = true)}
			/>
		{:else}
			<div class="book-card__cover book-card__cover--no-image">
				<span class="book-card__placeholder-author">{book.author}{#if book.year}<span class="book-card__year"> · {book.year}</span>{/if}</span>
				<span class="book-card__placeholder-title">{book.title}</span>
			</div>
		{/if}
	</div>
	<div class="book-card__body">
		<div
			class="book-card__rating"
			role="group"
			aria-label="Rate this book 1 to 5 stars"
			onmouseleave={() => (hoverRating = 0)}
		>
			{#each RATING_OPTIONS as value}
				<button
					type="button"
					class="book-card__star"
					class:book-card__star--active={displayRating >= value}
					aria-label="Rate {value} out of 5"
					aria-pressed={currentRating === value}
					onmouseenter={() => (hoverRating = value)}
					onclick={() => ratingsStore.setRating(book.id, value)}
				>
					<span aria-hidden="true">
						{displayRating >= value ? STAR_FILLED : STAR_EMPTY}
					</span>
				</button>
			{/each}
		</div>
	</div>
</article>

<style>
	.book-card {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 0;
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
		transition: box-shadow 0.2s ease, border-color 0.2s ease;
	}
	.book-card:hover {
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
		border-color: var(--color-border-hover, #d0d0d0);
	}
	.book-card__media {
		aspect-ratio: 2 / 3;
		width: 100%;
		overflow: hidden;
		background: var(--color-card-bg);
		padding: 0 0.375rem;
		padding-top: 0.375rem;
	}
	.book-card__cover {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: var(--radius-sm);
	}
	.book-card__cover--no-image {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.75rem;
		background: var(--color-card-placeholder-bg);
		border-radius: var(--radius-sm);
		text-align: left;
	}
	.book-card__placeholder-author {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
	.book-card__placeholder-title {
		font-size: 0.9375rem;
		font-weight: 600;
		line-height: 1.35;
		letter-spacing: -0.01em;
		color: var(--color-text);
	}
	.book-card__body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		padding: 0.625rem 0.75rem 0.75rem;
		gap: 0.375rem;
	}
	.book-card__rating {
		display: flex;
		gap: 0.125rem;
		flex-wrap: nowrap;
		white-space: nowrap;
		min-width: min-content;
		margin-bottom: 0.125rem;
	}
	.book-card__star {
		min-width: 1.75rem;
		min-height: 1.75rem;
		padding: 0.2rem;
		font-size: 1.0625rem;
		line-height: 1;
		border: none;
		background: transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
		color: var(--color-text-muted);
	}
	.book-card__star:hover {
		background: var(--color-bg-hover);
		color: var(--color-text);
	}
	.book-card__star:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.book-card__star--active {
		background: var(--color-accent-bg);
		color: var(--color-accent);
	}
	.book-card__year {
		opacity: 0.75;
	}
</style>
