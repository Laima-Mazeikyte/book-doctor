<script lang="ts">
	import Spinner from '$lib/components/Spinner.svelte';
	import { t } from '$lib/copy';

	interface Props {
		message?: string;
	}

	let { message = t('recommendations.shortlist.loading') }: Props = $props();
</script>

<div class="shortlist-state" aria-live="polite" aria-busy="true">
	<Spinner />
	{#if message}
		<p class="shortlist-state__message typ-body">{message}</p>
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
	}
	.shortlist-state__message {
		margin: 0;
		max-width: 20rem;
		text-align: center;
		color: var(--color-text-muted);
	}
</style>
