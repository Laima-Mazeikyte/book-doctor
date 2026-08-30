<script lang="ts">
	import { t } from '$lib/copy';
	import type { DisplayFeature } from '$lib/lab/author-prominence/display';
	import {
		standingPercentileBadge,
		type DimensionStandings,
		type StandingFeature
	} from '$lib/lab/author-prominence/standings';

	interface Props {
		features: DisplayFeature[];
		standings: DimensionStandings | null;
		authorIndex: number;
		populationCount: number;
	}

	let { features, standings, authorIndex, populationCount }: Props = $props();

	function rankFor(feature: DisplayFeature): number {
		return standings?.byFeature[feature.key as StandingFeature]?.[authorIndex] ?? 0;
	}
</script>

<section class="prominence-standings" data-testid="prominence-standings">
	<h3>{t('lab.authorProminence.detail.dimensionStandings')}</h3>
	<div class="prominence-standings__grid" aria-busy={!standings}>
		{#each features as feature (feature.key)}
			{@const rank = rankFor(feature)}
			<div class="prominence-standing" style:--standing-colour={feature.colour}>
				<span class="prominence-standing__label">{feature.label}</span>
				{#if rank > 0}
					<strong aria-label={`${feature.label}, rank ${rank} of ${populationCount}`}
						>#{rank.toLocaleString()}</strong
					>
					{#if standingPercentileBadge(rank, populationCount)}
						<span class="prominence-standing__badge">
							{standingPercentileBadge(rank, populationCount)}
						</span>
					{/if}
				{:else}
					<span class="prominence-standing__skeleton" aria-hidden="true"></span>
				{/if}
			</div>
		{/each}
	</div>
</section>

<style>
	.prominence-standings {
		padding-top: 16px;
		border-top: 1px solid rgba(164, 204, 206, 0.14);
	}
	.prominence-standings h3 {
		margin: 0 0 10px;
		color: rgba(207, 231, 232, 0.72);
		font: 600 11px/1.2 var(--font-family-interactive);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.prominence-standings__grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 7px;
	}
	.prominence-standing {
		display: flex;
		min-width: 0;
		min-height: 74px;
		flex-direction: column;
		justify-content: space-between;
		padding: 9px 8px;
		border: 1px solid color-mix(in srgb, var(--standing-colour) 34%, transparent);
		border-radius: 5px;
		background: color-mix(in srgb, var(--standing-colour) 6%, transparent);
	}
	.prominence-standing__label {
		color: var(--standing-colour);
		font: 600 10px/1.2 var(--font-family-interactive);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.prominence-standing strong {
		color: #efffff;
		font: 650 18px var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
	}
	.prominence-standing__badge {
		align-self: flex-start;
		padding: 2px 4px;
		border-radius: 3px;
		background: color-mix(in srgb, var(--standing-colour) 18%, transparent);
		color: #d8eeee;
		font: 600 9px/1.1 var(--font-family-interactive);
		white-space: nowrap;
	}
	.prominence-standing__skeleton {
		display: block;
		width: 54px;
		height: 20px;
		border-radius: 3px;
		background: rgba(207, 231, 232, 0.13);
	}
	@media (max-width: 360px) {
		.prominence-standing {
			padding-inline: 5px;
		}
		.prominence-standing__label {
			font-size: 9px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.prominence-standing__skeleton {
			animation: none;
		}
	}
</style>
