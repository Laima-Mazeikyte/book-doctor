<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { t } from '$lib/copy';

	interface Props {
		title?: string;
		message?: string;
		ratedCount: number;
		onRetry?: () => void;
	}

	let {
		title = t('shared.recommendationsEmpty.title'),
		message = t('shared.recommendationsEmpty.defaultMessage'),
		ratedCount,
		onRetry
	}: Props = $props();
</script>

<div class="recommendations-empty">
	<h1 class="recommendations-empty__title typ-display2">{title}</h1>
	<p class="recommendations-empty__message typ-body">{message}</p>
	<p class="recommendations-empty__count typ-caption">
		{t('shared.recommendationsEmpty.youRatedCount', { count: ratedCount })}{ratedCount === 1
			? ''
			: t('shared.recommendationsEmpty.youRatedCountPlural')}.
	</p>
	{#if onRetry}
		<Button variant="primary" onclick={onRetry}>{t('recommendations.retry')}</Button>
	{/if}
</div>

<style>
	.recommendations-empty {
		text-align: center;
	}
	.recommendations-empty :global(.btn) {
		margin-top: var(--space-2);
	}
	.recommendations-empty__title {
		margin: 0 0 var(--space-4) 0;
	}
	.recommendations-empty__message {
		color: var(--color-text-muted);
		margin: 0 0 var(--space-2) 0;
	}
	.recommendations-empty__count {
		color: var(--color-text-muted);
		margin: 0 0 var(--space-6) 0;
	}
</style>
