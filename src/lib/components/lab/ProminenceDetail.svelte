<script lang="ts">
	import { t } from '$lib/copy';
	import ContributionBars from './ContributionBars.svelte';
	import {
		auditBadges,
		contributions,
		formatScore,
		isCalibrated,
		placeOf
	} from '$lib/lab/author-prominence/score';
	import type { Population, ProminenceManifest, Ranking } from '$lib/lab/author-prominence/types';

	/** Everything about one selected author, including how the score is composed. */

	interface Props {
		manifest: ProminenceManifest;
		population: Population;
		ranking: Ranking;
		authorIndex: number;
		weights: number[];
		scale: number;
	}

	let { manifest, population, ranking, authorIndex, weights, scale }: Props = $props();

	const values = $derived(contributions(population, authorIndex, weights, ranking.denominator));
	const badges = $derived(auditBadges(population, authorIndex, values, manifest));
	const place = $derived(placeOf(ranking, authorIndex));
	const aheadOf = $derived((100 * (population.count - place)) / population.count);
	const tier = $derived(population.bestTier[authorIndex]);
	const concentration = $derived(population.concentration[authorIndex]);

	const number = (value: number): string => value.toLocaleString();
</script>

<section class="detail">
	<h3 class="detail__name">{population.names[authorIndex]}</h3>

	<dl class="detail__facts">
		<div class="detail__fact">
			<dt>
				{isCalibrated(manifest)
					? t('lab.authorProminence.detail.scoreCalibrated')
					: t('lab.authorProminence.detail.score')}
			</dt>
			<dd>{formatScore(manifest, ranking.scores[authorIndex])}</dd>
		</div>
		<div class="detail__fact">
			<dt>{t('lab.authorProminence.detail.rank')}</dt>
			<dd>
				{t('lab.authorProminence.detail.rankValue', {
					place: number(place),
					total: number(population.count)
				})}
			</dd>
		</div>
		<div class="detail__fact">
			<dt>{t('lab.authorProminence.detail.aheadOf')}</dt>
			<dd>
				{t('lab.authorProminence.detail.aheadOfValue', {
					percent: aheadOf >= 99.95 ? '>99.9' : aheadOf.toFixed(1)
				})}
			</dd>
		</div>
		<div class="detail__fact">
			<dt>{t('lab.authorProminence.detail.readers')}</dt>
			<dd>{number(population.nReaders[authorIndex])}</dd>
		</div>
		<div class="detail__fact">
			<dt>{t('lab.authorProminence.detail.books')}</dt>
			<dd>{number(population.nBooks[authorIndex])}</dd>
		</div>
		<div class="detail__fact">
			<dt>{t('lab.authorProminence.detail.awards')}</dt>
			<dd>
				{tier > 0
					? t('lab.authorProminence.detail.awardsValue', {
							count: number(population.nAwards[authorIndex]),
							tier
						})
					: t('lab.authorProminence.detail.awardsNone')}
			</dd>
		</div>
		{#if Number.isFinite(concentration)}
			<div class="detail__fact">
				<dt>{t('lab.authorProminence.detail.concentration')}</dt>
				<dd>{concentration.toFixed(2)}</dd>
			</div>
		{/if}
	</dl>

	<h4 class="detail__heading">{t('lab.authorProminence.detail.composition')}</h4>
	<ContributionBars
		features={manifest.model.features}
		labels={manifest.model.feature_labels}
		{values}
		{scale}
	/>

	{#each badges as badge (badge.badge)}
		<p class="detail__badge-note">
			<span class="detail__badge">{badge.badge}</span>
			{badge.explain}
		</p>
	{/each}

	{#if Number.isFinite(concentration)}
		<p class="detail__note">{t('lab.authorProminence.detail.concentrationNote')}</p>
	{/if}
</section>

<style>
	.detail {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		min-width: 0;
	}
	.detail__name {
		margin: 0;
		font-family: var(--typ-h3-font-family);
		font-size: var(--primitive-type-size-20);
		letter-spacing: var(--typ-h3-letter-spacing);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}
	.detail__facts {
		display: flex;
		flex-direction: column;
		margin: 0;
	}
	.detail__fact {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--color-border);
	}
	.detail__fact dt {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
	}
	.detail__fact dd {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: var(--color-text);
	}
	.detail__heading {
		margin: var(--space-2) 0 0 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.detail__badge {
		display: inline-block;
		padding: 2px var(--space-2);
		margin-right: var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		font-weight: 600;
		color: var(--color-text);
	}
	.detail__badge-note,
	.detail__note {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.6;
		color: var(--color-text-muted);
	}
</style>
