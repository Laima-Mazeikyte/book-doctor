<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { t } from '$lib/copy';

	interface Props {
		onRetry?: () => void;
		kind?: 'timeout' | 'backend';
		busy?: boolean;
	}

	let { onRetry, kind = 'timeout', busy = false }: Props = $props();
</script>

<div class="shortlist-state" role="alert">
	<p class="shortlist-state__title typ-h3">
		{#if kind === 'backend'}[COPY: recommendation-generation-failed-title]{:else}{t(
				'recommendations.shortlist.failureTitle'
			)}{/if}
	</p>
	<p class="shortlist-state__message typ-body">
		{#if kind === 'backend'}[COPY: recommendation-generation-failed-message]{:else}{t(
				'recommendations.shortlist.failureMessage'
			)}{/if}
	</p>
	{#if onRetry}
		<Button variant="primary" onclick={onRetry} disabled={busy}
			>{#if kind === 'backend'}[COPY: recommendation-generation-failed-action]{:else}{t(
					'recommendations.shortlist.retry'
				)}{/if}</Button
		>
	{/if}
</div>

<style>
	.shortlist-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		flex: 1;
		min-height: 0;
		padding: var(--space-8) var(--space-4);
		padding-bottom: calc(var(--space-8) + env(safe-area-inset-bottom, 0px));
		text-align: center;
	}
	.shortlist-state__title {
		margin: 0;
	}
	.shortlist-state__message {
		margin: 0;
		max-width: 22rem;
		color: var(--color-text-muted);
	}
</style>
