<script lang="ts">
	import { t } from '$lib/copy';
	import DirectionCard from './DirectionCard.svelte';
	import { STATUS_KEYS, type Author } from '$lib/lab/author-taste/types';
	import type { PairComparison } from '$lib/lab/author-taste/comparison';

	interface Props {
		first: Author | null;
		second: Author | null;
		/** Null only when nothing has been asked for yet, or the request failed. */
		record: PairComparison | null;
		loading: boolean;
		error: string | null;
		onRetry?: () => void;
	}

	let { first, second, record, loading, error, onRetry }: Props = $props();

	const releaseComparison = $derived(record?.mode === 'release' && record.status !== null);
	const statusKey = $derived(
		releaseComparison && record?.status !== null && record?.status !== undefined
			? STATUS_KEYS[record.status]
			: null
	);

	/**
	 * The two one-way classes are the same claim with the names swapped, so they share one
	 * headline and note keyed on which author leads rather than duplicating the wording.
	 */
	const oneSided = $derived(releaseComparison && (record?.status === 2 || record?.status === 3));
	const leader = $derived(record?.status === 3 ? second : first);
	const follower = $derived(record?.status === 3 ? first : second);
	const statusCopy = $derived(oneSided ? 'oneSided' : statusKey);
	const statusParams = $derived({
		first: first?.name ?? '',
		second: second?.name ?? '',
		leader: leader?.name ?? '',
		follower: follower?.name ?? ''
	});

	/** Nothing to compute from: no reader holds a clear opinion on both authors. */
	const noUsableData = $derived(
		record?.self.displayState === 'not_enough_data' &&
			record?.reverse.displayState === 'not_enough_data'
	);
</script>

<div class="compare-panel">
	{#if error}
		<div class="compare-panel__error" role="alert">
			<p>{error}</p>
			{#if onRetry}
				<button type="button" class="btn btn--secondary btn--compact" onclick={onRetry}>
					{t('lab.authorConnections.errors.retry')}
				</button>
			{/if}
		</div>
	{:else if !first && !second}
		<p class="compare-panel__empty">{t('lab.authorConnections.compare.emptyBoth')}</p>
	{:else if !first || !second}
		<p class="compare-panel__empty">{t('lab.authorConnections.compare.emptyOne')}</p>
	{:else if first.id === second.id}
		<p class="compare-panel__empty">{t('lab.authorConnections.compare.sameAuthor')}</p>
	{:else if loading}
		<p class="compare-panel__empty">{t('lab.authorConnections.compare.loading')}</p>
	{:else if !record || noUsableData}
		<!--
			Not "no relationship". Either nothing came back, or the two authors have no readers in
			common with a clear opinion on both — there is simply nothing to compute from.
		-->
		<div class="compare-panel__unretained">
			<p class="compare-panel__headline compare-panel__headline--quiet">
				{t('lab.authorConnections.states.notEnoughData')}
			</p>
			<p class="compare-panel__note">{t('lab.authorConnections.wording.notEnoughDataNote')}</p>
		</div>
	{:else}
		<header class="compare-panel__header">
			<p class="compare-panel__pair">
				<span>{first.name}</span>
				<span class="compare-panel__arrow" aria-hidden="true">↕</span>
				<span>{second.name}</span>
			</p>
			{#if releaseComparison && statusCopy}
				<p
					class="compare-panel__headline"
					class:compare-panel__headline--strong={record.status === 2 || record.status === 3}
				>
					{t(`lab.authorConnections.status.${statusCopy}.headline`, statusParams)}
				</p>
				<p class="compare-panel__note">
					{t(`lab.authorConnections.status.${statusCopy}.note`, statusParams)}
				</p>
			{/if}
		</header>

		<!-- The two directions are a matched pair, so they sit side by side rather than stacked. -->
		<div class="compare-panel__directions">
			<DirectionCard estimate={record.self} source={first} target={second} />
			<DirectionCard estimate={record.reverse} source={second} target={first} />
		</div>
	{/if}
</div>

<style>
	.compare-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
		container-type: inline-size;
	}
	.compare-panel__empty {
		margin: 0;
		padding: var(--space-6) var(--space-4);
		text-align: center;
		color: var(--color-text-muted);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius);
	}
	.compare-panel__error {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: flex-start;
		padding: var(--space-4);
		background: var(--color-error-bg);
		border: 1px solid var(--color-error-border);
		border-radius: var(--radius);
		color: var(--color-error-text);
	}
	.compare-panel__error p {
		margin: 0;
	}
	.compare-panel__unretained {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: center;
		text-align: center;
		padding: var(--space-5) var(--space-4);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius);
	}
	.compare-panel__header {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: center;
		text-align: center;
	}
	.compare-panel__pair {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		margin: 0;
		font-family: var(--typ-h3-font-family);
		font-size: var(--primitive-type-size-20);
		letter-spacing: var(--typ-h3-letter-spacing);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}
	.compare-panel__arrow {
		color: var(--color-text-muted);
	}
	.compare-panel__headline {
		margin: 0;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-pill);
		background: var(--color-accent-bg);
		color: var(--color-text);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-16);
	}
	.compare-panel__headline--strong {
		background: var(--color-viz-map-focus-ring);
	}
	.compare-panel__headline--quiet {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.compare-panel__note {
		margin: 0;
		max-width: 42rem;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.5;
		color: var(--color-text-muted);
	}
	/* One card per direction, side by side once the comparison area itself has room. */
	.compare-panel__directions {
		display: grid;
		gap: var(--space-4);
		align-items: start;
	}
	/* The inspector can be narrow on a wide screen, so use the container rather than the viewport. */
	@container (min-width: 52rem) {
		.compare-panel__directions {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
