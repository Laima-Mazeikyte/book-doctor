<script lang="ts">
	import { t } from '$lib/copy';
	import { formatPeakPercentage } from '$lib/lab/author-prominence/presentation';
	import { LENS_WEIGHT_TOLERANCE } from '$lib/lab/author-prominence/lens';
	import type { DisplayFeature } from '$lib/lab/author-prominence/display';
	import type { NormalizedAuthorDetail } from '$lib/lab/author-prominence/types';

	interface Props {
		detail: NormalizedAuthorDetail;
		features: DisplayFeature[];
		currentWeights: ArrayLike<number>;
		onUseBestMix: () => void;
	}

	let { detail, features, currentWeights, onUseBestMix }: Props = $props();

	function compactFeatureLabel(label: string): string {
		const compact = label.trim().split(/\s+/).at(-1) ?? label;
		return compact ? compact.charAt(0).toUpperCase() + compact.slice(1) : label;
	}

	const isActive = $derived.by(() => {
		if (currentWeights.length !== detail.peakWeights.length) return false;
		for (let index = 0; index < currentWeights.length; index++) {
			if (
				Math.abs(currentWeights[index] - (detail.peakWeights[index] ?? Number.NaN)) >
				LENS_WEIGHT_TOLERANCE
			)
				return false;
		}
		return true;
	});
</script>

<section class="prominence-peak" data-testid="prominence-peak">
	<div class="prominence-peak__summary">
		<div
			class="prominence-peak__rank"
			aria-label={`${t('lab.authorProminence.detail.bestRank')} ${detail.peakRank}`}
		>
			<h3>{t('lab.authorProminence.detail.bestRank')}</h3>
			<strong>#{detail.peakRank.toLocaleString()}</strong>
		</div>
		<div class="prominence-peak__weights" aria-label="Weights that produce the best rank">
			{#each features as feature, index (feature.key)}
				<span class="prominence-peak__weight">
					<span class="prominence-peak__dot" style:background={feature.colour} aria-hidden="true"
					></span>
					<span title={feature.label}>{compactFeatureLabel(feature.label)}</span>
					<strong>{formatPeakPercentage(detail.peakWeights[index] ?? 0)}</strong>
				</span>
			{/each}
		</div>
		<button
			type="button"
			class="prominence-peak__action"
			disabled={isActive}
			aria-label={isActive
				? t('lab.authorProminence.detail.bestMixActive')
				: t('lab.authorProminence.detail.useBestMix')}
			onclick={onUseBestMix}
			>{isActive
				? t('lab.authorProminence.detail.bestMixActive')
				: t('lab.authorProminence.detail.useBestMix')}</button
		>
	</div>
</section>

<style>
	.prominence-peak {
		padding-top: 10px;
		border-top: 1px solid rgba(164, 204, 206, 0.14);
	}
	.prominence-peak__summary {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr) max-content;
		align-items: center;
		gap: 8px 10px;
	}
	.prominence-peak__rank {
		display: inline-flex;
		align-items: baseline;
		flex: 0 0 auto;
		gap: 5px;
	}
	.prominence-peak__rank h3 {
		margin: 0;
		color: rgba(207, 231, 232, 0.72);
		font: 600 11px/1.2 var(--font-family-interactive);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.prominence-peak__rank strong {
		color: #efffff;
		font: 650 18px var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
	}
	.prominence-peak__action {
		min-height: 44px;
		padding: 8px 11px;
		border: 1px solid rgba(134, 216, 189, 0.46);
		border-radius: 5px;
		background: transparent;
		color: #bce8d8;
		cursor: pointer;
		font: 600 11px var(--font-family-interactive);
	}
	.prominence-peak__action:hover:not(:disabled) {
		background: rgba(57, 197, 150, 0.12);
	}
	.prominence-peak__action:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.prominence-peak__action:disabled {
		border-color: rgba(164, 204, 206, 0.2);
		color: rgba(207, 231, 232, 0.52);
		cursor: default;
	}
	.prominence-peak__weights {
		display: inline-flex;
		align-items: baseline;
		min-width: 0;
		flex-wrap: nowrap;
		gap: 5px 9px;
		overflow: hidden;
	}
	.prominence-peak__weight {
		display: inline-flex;
		align-items: baseline;
		flex: 0 1 auto;
		gap: 4px;
		min-width: 0;
		color: rgba(207, 231, 232, 0.62);
		font: 10px/1.2 var(--font-family-interactive);
	}
	.prominence-peak__weight span:not(.prominence-peak__dot) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.prominence-peak__weight strong {
		color: #efffff;
		font: 650 11px var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
	}
	.prominence-peak__dot {
		align-self: center;
		flex: 0 0 auto;
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	@media (max-width: 600px) {
		.prominence-peak__summary {
			grid-template-columns: minmax(0, 1fr) max-content;
		}
		.prominence-peak__rank,
		.prominence-peak__weights {
			grid-column: 1 / -1;
		}
		.prominence-peak__weights {
			flex-wrap: wrap;
			overflow: visible;
		}
		.prominence-peak__action {
			grid-column: 2;
			justify-self: end;
		}
	}
	@media (max-width: 360px) {
		.prominence-peak__weights {
			gap: 4px 6px;
		}
		.prominence-peak__weight {
			font-size: 9px;
		}
	}
</style>
