<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { t } from '$lib/copy';
	import { notInterestedPageLoader } from '$lib/notInterested/pageLoader';
	import type { NotInterestedOrder, NotInterestedPageState } from '$lib/notInterested/types';

	interface Props {
		state: NotInterestedPageState;
		order: NotInterestedOrder;
	}

	let { state, order }: Props = $props();

	const loadingMore = $derived(state.loading && state.loaded);
	const showFooter = $derived(Boolean(state.error || state.nextCursor || loadingMore));
</script>

{#if showFooter}
	<div class="not-interested-pagination">
		{#if state.error}
			<div class="not-interested-pagination__error" role="alert">
				<p>{t('notInterested.loadError')}</p>
				<Button
					variant="tertiary"
					compact
					onclick={() => void notInterestedPageLoader.retry(order)}
				>
					{t('notInterested.retry')}
				</Button>
			</div>
		{:else if state.nextCursor && !state.loading}
			<Button variant="secondary" onclick={() => void notInterestedPageLoader.loadMore(order)}>
				{t('notInterested.loadMore')}
			</Button>
		{/if}
		{#if loadingMore}
			<div class="not-interested-pagination__spinner" aria-live="polite">
				<Spinner size="sm" />
			</div>
		{/if}
	</div>
{/if}

<style>
	.not-interested-pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		margin-top: var(--space-5);
	}
	.not-interested-pagination__error {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		text-align: center;
	}
	.not-interested-pagination__error p {
		margin: 0;
		color: var(--color-error-text);
	}
	.not-interested-pagination__spinner {
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
