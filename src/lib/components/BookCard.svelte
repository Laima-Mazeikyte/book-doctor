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
		<div class="book-card__media-inner">
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
					onclick={() => ratingsStore.setRating(book.id, value, book.book_id, book)}
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
		box-shadow: var(--shadow-card);
		transition: box-shadow var(--duration-normal) var(--ease-default),
			border-color var(--duration-normal) var(--ease-default);
	}
	.book-card:hover {
		box-shadow: var(--shadow-card-hover);
		border-color: var(--color-border-hover);
	}
	.book-card__media {
		flex: 0 0 auto;
		aspect-ratio: 2 / 3;
		width: 100%;
		min-height: 0;
		background: var(--color-card-bg);
		padding: 0 var(--space-2);
		padding-top: var(--space-2);
	}
	.book-card__media-inner {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		border-radius: var(--radius-sm);
	}
	.book-card__cover {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center center;
		border-radius: var(--radius-sm);
		transition: transform var(--duration-normal) var(--ease-default);
	}
	.book-card:hover .book-card__cover:not(.book-card__cover--no-image) {
		transform: scale(1.05);
	}
	.book-card__cover--no-image {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-card-placeholder-bg);
		border-radius: var(--radius-sm);
		text-align: left;
		transition: transform var(--duration-normal) var(--ease-default);
		transform-origin: center center;
	}
	.book-card:hover .book-card__cover--no-image {
		transform: scale(1.03);
	}
	.book-card__placeholder-author {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.book-card__placeholder-title {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		line-height: 1.35;
		letter-spacing: -0.01em;
		color: var(--color-text);
	}
	.book-card__body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		height: fit-content;
		padding: 8px;
		gap: 0;
		justify-content: flex-start;
		align-items: center;
		vertical-align: top;
	}
	/* rating strip: no extra margin so body hugs stars */
	.book-card__rating {
		display: flex;
		gap: 0;
		justify-content: flex-start;
		align-items: center;
		flex-wrap: nowrap;
		white-space: nowrap;
		min-width: min-content;
	}
	.book-card__star {
		min-width: 2.25rem;
		min-height: 2.25rem;
		padding: var(--space-1);
		font-size: 1.375rem;
		line-height: 1;
		border: none;
		background: transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
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
		background: transparent;
		color: var(--color-text);
	}
	.book-card__year {
		opacity: 0.75;
	}
</style>
