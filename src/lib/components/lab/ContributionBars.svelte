<script lang="ts">
	import { formatContribution } from '$lib/lab/author-prominence/score';

	/**
	 * Diverging bars showing where an author's score comes from.
	 *
	 * Colour carries feature identity; the side of the baseline carries the sign. Every bar
	 * is directly labelled with its value, so identity and magnitude are both readable
	 * without relying on colour — the bars sum to the score shown beside them.
	 */

	interface Props {
		features: string[];
		labels: Record<string, string>;
		/** Per-feature contributions, in `features` order. */
		values: number[];
		/** Half-width of the track, in contribution units. Shared across the visible set. */
		scale: number;
	}

	let { features, labels, values, scale }: Props = $props();

	/** Fixed slot order, never cycled. A fourth feature would need a fourth token. */
	const SLOTS = [
		'var(--color-viz-series-1)',
		'var(--color-viz-series-2)',
		'var(--color-viz-series-3)'
	];

	const bars = $derived(
		features.map((feature, i) => {
			const value = values[i] ?? 0;
			return {
				feature,
				label: labels[feature] ?? feature,
				value,
				colour: SLOTS[i] ?? 'var(--color-viz-neutral)',
				// Half the track is one arm, so a full-scale contribution fills 50%.
				width: Math.min(Math.abs(value) / scale, 1) * 50,
				positive: value >= 0
			};
		})
	);
</script>

<div class="bars">
	{#each bars as bar (bar.feature)}
		<div class="bars__row">
			<span class="bars__label">{bar.label}</span>
			<span class="bars__track">
				<span class="bars__baseline"></span>
				<span
					class="bars__fill"
					class:bars__fill--positive={bar.positive}
					style:width="{bar.width}%"
					style:background={bar.colour}
				></span>
			</span>
			<span class="bars__value">{formatContribution(bar.value)}</span>
		</div>
	{/each}
</div>

<style>
	.bars {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
	}
	.bars__row {
		display: grid;
		grid-template-columns: minmax(0, 8.5rem) minmax(0, 1fr) 3.25rem;
		gap: var(--space-3);
		align-items: center;
	}
	.bars__label,
	.bars__value {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}
	.bars__value {
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}
	.bars__track {
		position: relative;
		height: 0.5rem;
		background: var(--color-viz-track);
		border-radius: var(--radius-pill);
	}
	.bars__baseline {
		position: absolute;
		top: -2px;
		bottom: -2px;
		left: 50%;
		width: 1px;
		background: var(--color-viz-baseline);
	}
	.bars__fill {
		position: absolute;
		top: 0;
		bottom: 0;
		/* Anchored to the baseline; only the outer end is rounded. */
		right: 50%;
		border-radius: var(--radius-xs) 0 0 var(--radius-xs);
	}
	.bars__fill--positive {
		right: auto;
		left: 50%;
		border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
	}

	@media (max-width: 30rem) {
		.bars__row {
			grid-template-columns: minmax(0, 1fr) 3.25rem;
			row-gap: var(--space-1);
		}
		.bars__label {
			grid-column: 1 / -1;
		}
	}
</style>
