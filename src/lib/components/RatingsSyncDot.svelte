<script lang="ts">
	interface Props {
		variant?: 'pending' | 'failed';
	}

	let { variant = 'pending' }: Props = $props();
</script>

{#if variant === 'failed'}
	<span class="ratings-sync-dot ratings-sync-dot--failed" aria-hidden="true">!</span>
{:else}
	<span class="ratings-sync-dot ratings-sync-dot--pending" aria-hidden="true"></span>
{/if}

<style>
	.ratings-sync-dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 999px;
	}
	.ratings-sync-dot--pending {
		background: color-mix(in srgb, var(--color-book-rating-star) 72%, var(--color-bg));
		animation: ratings-sync-dot-pulse 1.4s ease-in-out infinite;
	}
	.ratings-sync-dot--failed {
		width: 0.875rem;
		height: 0.875rem;
		background: var(--color-danger-tonal-bg);
		border: 1px solid var(--color-danger-tonal-border);
		color: var(--color-danger-tonal-text);
		font-family: var(--typ-caption-font-family);
		font-size: 0.625rem;
		font-weight: var(--font-weight-semibold);
		line-height: 1;
	}
	@keyframes ratings-sync-dot-pulse {
		0%,
		100% {
			opacity: 0.55;
			transform: scale(0.92);
		}
		50% {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>
