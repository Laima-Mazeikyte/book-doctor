<script lang="ts">
	import Spinner from '$lib/components/Spinner.svelte';
	import { t } from '$lib/copy';

	interface Props {
		message?: string;
	}

	let { message = t('shared.recommendationsLoading.message') }: Props = $props();
</script>

<div class="recommendations-loading" aria-live="polite" aria-busy="true">
	<Spinner />
	{#if message}
		<p class="recommendations-loading__message">{message}</p>
	{/if}
</div>

<style>
	.recommendations-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		padding: var(--space-12) var(--space-4);
	}
	.recommendations-loading__message {
		margin: 0;
		color: var(--color-text-muted);
		font-family: var(--typ-body-font-family);
		font-size: var(--typ-body-font-size);
		font-weight: var(--typ-body-font-weight);
		line-height: var(--typ-body-line-height);
		letter-spacing: var(--typ-body-letter-spacing);
	}
</style>
