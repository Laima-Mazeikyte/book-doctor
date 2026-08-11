<script lang="ts">
	import { t } from '$lib/copy';
	import MetricTooltip from './MetricTooltip.svelte';
	import {
		directionColorWeight,
		formatInterval,
		formatPValue,
		formatPercentagePoints,
		formatQValue,
		formatRate
	} from '$lib/lab/author-taste/format';
	import {
		DISPLAY_STATE_COPY_KEYS,
		type ComparisonDirectionEstimate
	} from '$lib/lab/author-taste/comparison';
	import type { Author } from '$lib/lab/author-taste/types';

	interface Props {
		estimate: ComparisonDirectionEstimate;
		source: Author;
		target: Author;
	}

	let { estimate, source, target }: Props = $props();

	const points = $derived(estimate.rateDifference === null ? null : estimate.rateDifference * 100);
	const positive = $derived((estimate.rateDifference ?? 0) >= 0);
	const rate = $derived(formatRate(estimate.likeRate));
	const baseline = $derived(formatRate(estimate.baselineRate));
	const stateCopyKey = $derived(DISPLAY_STATE_COPY_KEYS[estimate.displayState]);
	const logOddsRatio = $derived(
		estimate.logOddsRatio === null ? '—' : estimate.logOddsRatio.toFixed(3)
	);
	const evidenceScore = $derived(
		estimate.evidenceScore === null ? '—' : estimate.evidenceScore.toFixed(3)
	);
	const colorWeight = $derived(
		directionColorWeight(estimate.rateDifference, estimate.mode === 'release' && estimate.selected)
	);
	const directionColor = $derived.by(() => {
		if (colorWeight === null) return 'var(--color-viz-neutral)';
		const hue = positive ? 'var(--color-viz-affinity)' : 'var(--color-viz-conflict)';
		return `color-mix(in srgb, ${hue} ${colorWeight}%, var(--color-text-muted))`;
	});
	const tooltipMessage = $derived(
		estimate.ciLower === null || estimate.ciUpper === null
			? t('lab.authorConnections.hover.insufficient')
			: null
	);
	const tooltipMetrics = $derived([
		{
			label: t('lab.authorConnections.hover.ci'),
			value: formatInterval(estimate.ciLower, estimate.ciUpper)
		},
		{
			label: t(
				estimate.mode === 'release'
					? 'lab.authorConnections.hover.qValue'
					: 'lab.authorConnections.hover.pValue'
			),
			value:
				estimate.mode === 'release'
					? formatQValue(estimate.negLog10Q)
					: formatPValue(estimate.pValue)
		}
	]);
	const probabilityLabel = $derived(
		t(
			estimate.mode === 'release'
				? 'lab.authorConnections.technical.qValueExact'
				: 'lab.authorConnections.technical.pValueExact'
		)
	);
	const probabilityNote = $derived(
		t(
			estimate.mode === 'release'
				? 'lab.authorConnections.technical.qValueNote'
				: 'lab.authorConnections.technical.pValueNote'
		)
	);
	const probabilityValue = $derived(
		estimate.mode === 'release' ? formatQValue(estimate.negLog10Q) : formatPValue(estimate.pValue)
	);
</script>

<!--
	One direction of a pair, as shipped. The rate difference, interval, shrunken evidence score
	and applicable p- or q-value all arrive finished. Release directionality remains authoritative;
	the frontend only formats those values and maps selected release effects onto the colour scale.
-->
<section class="direction-card" style:--direction-color={directionColor}>
	<h3 class="direction-card__title">{source.name} → {target.name}</h3>

	<p class="direction-card__significance">
		{t(`lab.authorConnections.states.${stateCopyKey}`)}
		<span
			class="direction-card__info"
			title={t(`lab.authorConnections.stateNotes.${stateCopyKey}`)}
			aria-hidden="true">i</span
		>
		<span class="direction-card__sr-only">
			{t(`lab.authorConnections.stateNotes.${stateCopyKey}`)}
		</span>
	</p>
	<p class="direction-card__question">
		{t('lab.authorConnections.wording.rateQuestion', { target: target.name })}
	</p>
	<div class="direction-card__rates-shell">
		<MetricTooltip
			id="author-direction-{source.id}-{target.id}-stats"
			metrics={tooltipMetrics}
			message={tooltipMessage}
			block={true}
		>
			<span class="direction-card__rates">
				<span class="direction-card__rate-group">
					<span class="direction-card__rate-label">
						{t('lab.authorConnections.wording.sourceGroup', { source: source.name })}
					</span>
					<strong class="direction-card__rate">{rate}</strong>
				</span>
				<span class="direction-card__rate-group">
					<span class="direction-card__rate-label">
						{t('lab.authorConnections.wording.otherGroup')}
					</span>
					<strong class="direction-card__rate">{baseline}</strong>
				</span>
			</span>
		</MetricTooltip>
	</div>

	<details class="direction-card__technical">
		<summary>{t('lab.authorConnections.technical.summary')}</summary>
		<table>
			<tbody>
				<tr>
					<td>
						<span class="direction-card__technical-label">
							{t('lab.authorConnections.technical.rateDifference')}
							<span
								class="direction-card__info"
								title={t('lab.authorConnections.technical.rateDifferenceNote')}
								aria-hidden="true">i</span
							>
							<span class="direction-card__sr-only">
								{t('lab.authorConnections.technical.rateDifferenceNote')}
							</span>
						</span>
					</td>
					<td>{formatPercentagePoints(points)}</td>
				</tr>
				<tr>
					<td>
						<span class="direction-card__technical-label">
							{t('lab.authorConnections.technical.ci')}
							<span
								class="direction-card__info"
								title={t('lab.authorConnections.technical.ciNote')}
								aria-hidden="true">i</span
							>
							<span class="direction-card__sr-only">
								{t('lab.authorConnections.technical.ciNote')}
							</span>
						</span>
					</td>
					<td>{formatInterval(estimate.ciLower, estimate.ciUpper)}</td>
				</tr>
				<tr>
					<td>
						<span class="direction-card__technical-label">
							{t('lab.authorConnections.technical.logOddsRatio')}
							<span
								class="direction-card__info"
								title={t('lab.authorConnections.technical.logOddsRatioNote')}
								aria-hidden="true">i</span
							>
							<span class="direction-card__sr-only">
								{t('lab.authorConnections.technical.logOddsRatioNote')}
							</span>
						</span>
					</td>
					<td>{logOddsRatio}</td>
				</tr>
				<tr>
					<td>
						<span class="direction-card__technical-label">
							{t('lab.authorConnections.technical.evidenceScore')}
							<span
								class="direction-card__info"
								title={t('lab.authorConnections.technical.evidenceScoreNote')}
								aria-hidden="true">i</span
							>
							<span class="direction-card__sr-only">
								{t('lab.authorConnections.technical.evidenceScoreNote')}
							</span>
						</span>
					</td>
					<td>{evidenceScore}</td>
				</tr>
				<tr>
					<td>
						<span class="direction-card__technical-label">
							{probabilityLabel}
							<span class="direction-card__info" title={probabilityNote} aria-hidden="true">i</span>
							<span class="direction-card__sr-only">
								{probabilityNote}
							</span>
						</span>
					</td>
					<td>{probabilityValue}</td>
				</tr>
			</tbody>
		</table>
	</details>
</section>

<style>
	.direction-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-left: 4px solid var(--direction-color);
		border-radius: var(--radius);
		background: var(--color-card-bg);
	}
	.direction-card__title {
		font-family: var(--typ-h3-font-family);
		font-size: var(--primitive-type-size-16);
		letter-spacing: var(--typ-h3-letter-spacing);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}
	.direction-card p {
		margin: 0;
	}
	.direction-card__question {
		font-family: var(--typ-caption-font-family);
		font-size: var(--primitive-type-size-16);
		font-weight: 600;
		color: var(--color-text);
	}
	.direction-card__rates {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
		width: 100%;
	}
	.direction-card__rates-shell {
		color: var(--direction-color);
	}
	.direction-card__rate-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.direction-card__rate-label {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.35;
		color: var(--color-text-muted);
	}
	.direction-card__rate {
		font-family: var(--typ-caption-font-family);
		font-size: var(--primitive-type-size-20);
		line-height: 1.1;
		color: inherit;
		font-variant-numeric: tabular-nums;
	}
	.direction-card__significance {
		font-family: var(--typ-caption-font-family);
		font-size: var(--primitive-type-size-16);
		font-weight: 600;
		color: var(--color-text);
	}
	.direction-card__technical {
		margin-top: var(--space-1);
	}
	.direction-card__technical summary {
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: var(--primitive-type-size-14);
	}
	.direction-card__technical table {
		width: 100%;
		border-collapse: collapse;
		margin-top: var(--space-2);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
	}
	.direction-card__technical td {
		padding: var(--space-1) 0;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.direction-card__technical td:last-child {
		text-align: right;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	.direction-card__technical-label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.direction-card__info {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		flex: none;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		font-size: var(--primitive-type-size-12, 0.75rem);
		font-style: italic;
		line-height: 1;
		cursor: help;
	}
	.direction-card__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
</style>
