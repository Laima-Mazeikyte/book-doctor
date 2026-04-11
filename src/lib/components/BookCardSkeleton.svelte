<script lang="ts">
	// Card-sized placeholder: undertone + fill layer; only the fill opacity pulses.
</script>

<article class="book-card-skeleton" aria-hidden="true"></article>

<style>
	@keyframes book-card-skeleton-fill-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.48;
		}
	}

	.book-card-skeleton {
		position: relative;
		overflow: hidden;
		aspect-ratio: 2 / 3;
		width: 100%;
		min-height: 12rem;
		border-radius: var(--radius);
		background: color-mix(
			in srgb,
			var(--color-card-placeholder-bg) 72%,
			var(--color-card-bg) 28%
		);
		border: 1px solid var(--color-border);
		box-shadow: var(--shadow-card);
	}

	.book-card-skeleton::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: var(--color-card-bg);
		animation: book-card-skeleton-fill-pulse 1.1s ease-in-out infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.book-card-skeleton::before {
			animation: none;
		}
	}
</style>
