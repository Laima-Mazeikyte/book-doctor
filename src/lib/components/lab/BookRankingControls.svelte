<script lang="ts">
	import { t } from '$lib/copy';

	interface Feature {
		id: string;
		label: string;
		blurb: string;
	}

	interface Preset {
		name: string;
		weights: number[];
		settled: boolean;
		reach_share?: number;
		note: string;
	}

	interface Props {
		features: Feature[];
		raw: number[];
		shares: number[];
		presets: Preset[];
		activePreset: string | null;
		showReachControl: boolean;
		reachShare: number;
		onSlide: (raw: number[]) => void;
		onPreset: (preset: Preset) => void;
		onReachShare: (value: number) => void;
	}

	let {
		features,
		raw,
		shares,
		presets,
		activePreset,
		showReachControl,
		reachShare,
		onSlide,
		onPreset,
		onReachShare
	}: Props = $props();

	function setSlider(index: number, value: number): void {
		const next = [...raw];
		next[index] = value;
		onSlide(next);
	}
</script>

<div class="ranking-controls">
	<section class="ranking-controls__section" aria-labelledby="book-search-weights-heading">
		<h2 class="ranking-controls__heading" id="book-search-weights-heading">
			{t('lab.bookSearch.weights.heading')}
		</h2>

		{#each features as feature, index (feature.id)}
			<div class="ranking-controls__slider" style:--slot="var(--color-viz-series-{index + 1})">
				<label class="ranking-controls__name" for="book-search-weight-{feature.id}">
					{feature.label}
				</label>
				<input
					id="book-search-weight-{feature.id}"
					type="range"
					min="0"
					max="100"
					step="1"
					value={raw[index] ?? 0}
					aria-valuetext={t('lab.bookSearch.weights.shareValueText', {
						percent: Math.round((shares[index] ?? 0) * 100)
					})}
					oninput={(event) => setSlider(index, Number(event.currentTarget.value))}
				/>
				<p class="ranking-controls__blurb">{feature.blurb}</p>
			</div>
		{/each}

		<div class="ranking-controls__mix" aria-hidden="true">
			{#each features as feature, index (feature.id)}
				<span
					class="ranking-controls__mix-part"
					style:flex-grow={shares[index] ?? 0}
					style:background="var(--color-viz-series-{index + 1})"
				></span>
			{/each}
		</div>
		<p class="ranking-controls__note">{t('lab.bookSearch.weights.mixNote')}</p>
	</section>

	{#if showReachControl}
		<section class="ranking-controls__section" aria-labelledby="book-search-reach-heading">
			<h2 class="ranking-controls__heading" id="book-search-reach-heading">
				{t('lab.bookSearch.culturalReach.heading')}
			</h2>
			<label class="ranking-controls__name" for="book-search-reach">
				{t('lab.bookSearch.culturalReach.label')}
			</label>
			<input
				id="book-search-reach"
				type="range"
				min="0"
				max="50"
				step="5"
				value={Math.round(reachShare * 100)}
				aria-valuetext={t('lab.bookSearch.culturalReach.value', {
					percent: Math.round(reachShare * 100)
				})}
				oninput={(event) => onReachShare(Number(event.currentTarget.value) / 100)}
			/>
			<p class="ranking-controls__blurb">{t('lab.bookSearch.culturalReach.blurb')}</p>
		</section>
	{/if}

	<section class="ranking-controls__section" aria-labelledby="book-search-presets-heading">
		<h2 class="ranking-controls__heading" id="book-search-presets-heading">
			{t('lab.bookSearch.presets.heading')}
		</h2>
		<div class="ranking-controls__presets">
			{#each presets as preset (preset.name)}
				<button
					type="button"
					class="ranking-controls__preset"
					class:ranking-controls__preset--active={activePreset === preset.name}
					aria-pressed={activePreset === preset.name}
					onclick={() => onPreset(preset)}
				>
					<span class="ranking-controls__preset-name">{preset.name}</span>
					<span class="ranking-controls__preset-note">{preset.note}</span>
				</button>
			{/each}
		</div>
	</section>
</div>

<style>
	.ranking-controls {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}
	.ranking-controls__section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.ranking-controls__heading {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.ranking-controls__slider {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.ranking-controls__name {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-weight: 600;
		color: var(--color-text);
	}
	.ranking-controls__slider input[type='range'] {
		width: 100%;
		accent-color: var(--slot, var(--color-accent));
	}
	#book-search-reach {
		width: 100%;
		accent-color: var(--color-viz-series-2);
	}
	.ranking-controls__blurb,
	.ranking-controls__note {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.5;
		color: var(--color-text-muted);
	}
	.ranking-controls__mix {
		display: flex;
		gap: 2px;
		height: 0.5rem;
		margin-top: var(--space-2);
	}
	.ranking-controls__mix-part {
		flex-basis: 0;
		min-width: 0;
		border-radius: var(--radius-xs);
	}
	.ranking-controls__presets {
		display: grid;
		gap: var(--space-2);
	}
	.ranking-controls__preset {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: 100%;
		padding: var(--space-3);
		text-align: left;
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		cursor: pointer;
		font: inherit;
		transition:
			border-color var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default);
	}
	.ranking-controls__preset:hover {
		border-color: var(--color-border-hover);
		background: var(--color-bg-hover);
	}
	.ranking-controls__preset:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.ranking-controls__preset--active {
		border-color: var(--color-accent);
		background: var(--color-accent-bg);
	}
	.ranking-controls__preset-name {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-weight: 600;
	}
	.ranking-controls__preset-note {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.5;
		color: var(--color-text-muted);
	}
</style>
