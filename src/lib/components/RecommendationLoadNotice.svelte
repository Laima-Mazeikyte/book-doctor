<script lang="ts">
	import { t } from '$lib/copy';

	let { onRetry }: { onRetry: () => void } = $props();
</script>

<div class="recommendation-load-notice typ-body" role="alert">
	<span>{t('recommendations.failedToLoad')}</span>
	<button type="button" onclick={onRetry}>{t('recommendations.retry')}</button>
</div>

<style>
	.recommendation-load-notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		gap: var(--space-2);
		padding: var(--space-3);
	}

	button {
		min-height: var(--min-tap);
		color: inherit;
		font: inherit;
		text-decoration: underline;
		border: 0;
		background: transparent;
		cursor: pointer;
	}

	button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
