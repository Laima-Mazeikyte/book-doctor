<script lang="ts">
	import { t } from '$lib/copy';
	import {
		evidenceStrength,
		formatInterval,
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
		/** Selection rule the release applied, for the technical note. */
		/**
		 * Only the checked set carries a globally corrected q-value. A pair worked out on request
		 * has none, and calling its evidence "weak" would assert something never measured.
		 */
		showEvidence?: boolean;
	}

	let { estimate, source, target, showEvidence = true }: Props = $props();

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
</script>

<!--
	One direction of a pair, as shipped. Every number here was computed upstream: the rate
	difference, its interval, the shrunken evidence score and the q-value all arrive finished
	in the connection record. Nothing is re-derived and nothing is re-thresholded, because the
	pair's directionality verdict was computed against these exact values.
-->
<section
	class="direction-card"
	class:direction-card--positive={estimate.displayState === 'validated' && positive}
	class:direction-card--negative={estimate.displayState === 'validated' && !positive}
	class:direction-card--unselected={estimate.displayState !== 'validated'}
>
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
	<div class="direction-card__rates">
		<div class="direction-card__rate-group">
			<span class="direction-card__rate-label">
				{t('lab.authorConnections.wording.sourceGroup', { source: source.name })}
			</span>
			<strong class="direction-card__rate">{rate}</strong>
		</div>
		<div class="direction-card__rate-group">
			<span class="direction-card__rate-label">
				{t('lab.authorConnections.wording.otherGroup')}
			</span>
			<strong class="direction-card__rate">{baseline}</strong>
		</div>
	</div>

	<!-- The strength word carries the meaning; the q-value it came from lives in the details. -->
	{#if showEvidence && estimate.negLog10Q !== null}
		<p class="direction-card__evidence">
			<strong
				>{t('lab.authorConnections.evidence.label')}: {t(
					`lab.authorConnections.evidence.${evidenceStrength(estimate.negLog10Q)}`
				)}</strong
			>
		</p>
	{/if}

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
							{t('lab.authorConnections.technical.qValueExact')}
							<span
								class="direction-card__info"
								title={t('lab.authorConnections.technical.qValueNote')}
								aria-hidden="true">i</span
							>
							<span class="direction-card__sr-only">
								{t('lab.authorConnections.technical.qValueNote')}
							</span>
						</span>
					</td>
					<td>{formatQValue(estimate.negLog10Q)}</td>
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
		border-left: 4px solid var(--color-viz-neutral);
		border-radius: var(--radius);
		background: var(--color-card-bg);
	}
	.direction-card--positive {
		border-left-color: var(--color-viz-affinity);
	}
	.direction-card--negative {
		border-left-color: var(--color-viz-conflict);
	}
	.direction-card--unselected {
		border-left-color: var(--color-viz-neutral);
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
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	.direction-card__significance {
		font-family: var(--typ-caption-font-family);
		font-size: var(--primitive-type-size-16);
		font-weight: 600;
		color: var(--color-text);
	}
	.direction-card__evidence {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.5;
		color: var(--color-text-muted);
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
