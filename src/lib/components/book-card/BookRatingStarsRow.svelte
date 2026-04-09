<script lang="ts">
	import { Star } from 'lucide-svelte';
	import type { RatingValue } from '$lib/types/book';

	const RATING_OPTIONS: RatingValue[] = [1, 2, 3, 4, 5];

	interface Props {
		displayRating: number;
		ariaGroupLabel: string;
		starAriaLabel: (value: RatingValue) => string;
		starAriaPressed: (value: RatingValue) => boolean;
		/** Matches in-card rate row (`[data-context='rate']`): shrink wrap instead of full width */
		ratingWrapWidth?: 'default' | 'auto';
		onmouseleave?: () => void;
		onstarEnter?: (value: RatingValue) => void;
		onstarClick?: (value: RatingValue) => void;
	}

	let {
		displayRating,
		ariaGroupLabel,
		starAriaLabel,
		starAriaPressed,
		ratingWrapWidth = 'default',
		onmouseleave,
		onstarEnter,
		onstarClick
	}: Props = $props();
</script>

<div
	class="book-card__rating-wrap"
	class:book-card__rating-wrap--auto={ratingWrapWidth === 'auto'}
>
	<div
		class="book-card__rating"
		role="group"
		aria-label={ariaGroupLabel}
		onmouseleave={onmouseleave}
	>
		{#each RATING_OPTIONS as value}
			<button
				type="button"
				class="book-card__star"
				class:book-card__star--active={displayRating >= value}
				aria-label={starAriaLabel(value)}
				aria-pressed={starAriaPressed(value)}
				onmouseenter={() => onstarEnter?.(value)}
				onclick={() => onstarClick?.(value)}
			>
				<span class="book-card__star-icon" aria-hidden="true">
					<Star fill={displayRating >= value ? 'currentColor' : 'none'} aria-hidden="true" />
				</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.book-card__rating-wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: center;
		width: 100%;
		min-width: 0;
	}
	.book-card__rating-wrap--auto {
		width: auto;
		align-items: center;
	}
	.book-card__rating {
		display: flex;
		gap: 0;
		justify-content: center;
		align-items: center;
		flex-wrap: nowrap;
		white-space: nowrap;
		min-width: min-content;
	}
	.book-card__star {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--book-card-star-min, 2.25rem);
		height: var(--book-card-star-min, 2.25rem);
		min-width: var(--book-card-star-min, 2.25rem);
		min-height: var(--book-card-star-min, 2.25rem);
		padding: 0;
		font-family: var(--typ-interactive-1-font-family);
		line-height: 1;
		letter-spacing: var(--typ-interactive-1-letter-spacing);
		border: none;
		background: transparent;
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition:
			background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
		color: var(--color-book-rating-star-muted);
	}
	.book-card__star-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
	}
	.book-card__star-icon :global(svg) {
		width: 100%;
		height: 100%;
	}
	.book-card__star:hover {
		background: var(--color-book-card-action-hover-bg);
		color: var(--color-book-rating-star);
	}
	.book-card__star:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.book-card__star--active {
		background: transparent;
		color: var(--color-book-rating-star);
	}

	@media (max-width: 479px) {
		.book-card__rating {
			min-width: 0;
		}
		.book-card__star {
			width: var(--book-card-star-min-sm, 1.75rem);
			height: var(--book-card-star-min-sm, 1.75rem);
			min-width: var(--book-card-star-min-sm, 1.75rem);
			min-height: var(--book-card-star-min-sm, 1.75rem);
		}
	}
</style>
