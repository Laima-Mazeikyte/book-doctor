<script lang="ts">
	import { t } from '$lib/copy';
	import type { ProminenceManifest } from '$lib/lab/author-prominence/types';

	/**
	 * The weight sliders and the presets that seed them.
	 *
	 * A handle says how much the reader cares about one feature. Only the ratio between the
	 * three matters, so three handles at the top mean the same thing as three in the middle —
	 * an even split.
	 *
	 * Nothing numeric is shown. A percentage readout has to move whenever *any* handle moves,
	 * so dragging one slider silently changed the other two numbers while their handles sat
	 * still, which reads as a glitch rather than as arithmetic. The mix bar carries the
	 * resulting split instead: it responds to every drag, and it shows the shares as a
	 * proportion, which is the only thing they are.
	 */

	interface Props {
		manifest: ProminenceManifest;
		/** Slider positions, 0–100, in `manifest.model.features` order. */
		raw: number[];
		/** The shares actually in effect, in `features` order. Sums to 1. */
		shares: number[];
		activePreset: string | null;
		onSlide: (raw: number[]) => void;
		onPreset: (name: string, weights: number[]) => void;
	}

	let { manifest, raw, shares, activePreset, onSlide, onPreset }: Props = $props();

	const features = $derived(manifest.model.features);

	function setSlider(index: number, value: number): void {
		const next = [...raw];
		next[index] = value;
		onSlide(next);
	}
</script>

<div class="weights">
	<section class="weights__section">
		<h2 class="weights__heading">{t('lab.authorProminence.weights.heading')}</h2>

		{#each features as feature, i (feature)}
			<div class="weights__slider" style:--slot="var(--color-viz-series-{i + 1})">
				<label class="weights__name" for="ap-weight-{feature}">
					{manifest.model.feature_labels[feature] ?? feature}
				</label>
				<input
					id="ap-weight-{feature}"
					type="range"
					min="0"
					max="100"
					step="1"
					value={raw[i]}
					aria-valuetext={t('lab.authorProminence.weights.shareValueText', {
						percent: Math.round(shares[i] * 100)
					})}
					oninput={(event) => setSlider(i, Number(event.currentTarget.value))}
				/>
				<p class="weights__blurb">{manifest.model.feature_blurbs[feature] ?? ''}</p>
			</div>
		{/each}

		<!-- Redundant for assistive tech: each slider already announces its own share. -->
		<div class="weights__mix" aria-hidden="true">
			{#each features as feature, i (feature)}
				<span
					class="weights__mix-part"
					style:flex-grow={shares[i]}
					style:background="var(--color-viz-series-{i + 1})"
				></span>
			{/each}
		</div>
		<p class="weights__mix-note">{t('lab.authorProminence.weights.mixNote')}</p>
	</section>

	<section class="weights__section">
		<h2 class="weights__heading">{t('lab.authorProminence.presets.heading')}</h2>
		<div class="weights__presets">
			{#each manifest.presets as preset (preset.name)}
				<button
					type="button"
					class="weights__preset"
					class:weights__preset--active={activePreset === preset.name}
					aria-pressed={activePreset === preset.name}
					onclick={() => onPreset(preset.name, preset.weights)}
				>
					<span class="weights__preset-name">
						{preset.name}
						{#if preset.settled}
							<span class="weights__preset-tag">
								{t('lab.authorProminence.presets.tested')}
							</span>
						{/if}
					</span>
					<span class="weights__preset-note">{preset.note}</span>
				</button>
			{/each}
		</div>
	</section>
</div>

<style>
	.weights {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}
	.weights__section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.weights__heading {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.weights__slider {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.weights__name {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-weight: 600;
		color: var(--color-text);
	}
	.weights__slider input[type='range'] {
		width: 100%;
		accent-color: var(--slot);
	}
	.weights__blurb {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.weights__mix {
		display: flex;
		/* Surface-coloured gaps keep adjacent segments from reading as one block. */
		gap: 2px;
		height: 0.5rem;
		margin-top: var(--space-2);
	}
	.weights__mix-part {
		flex-basis: 0;
		min-width: 0;
		border-radius: var(--radius-xs);
		/*
		 * Deliberately not transitioned. The width *is* the value, so an in-flight animation
		 * would mean the bar disagrees with the sliders for as long as it runs — and if
		 * anything stalls compositing it stays wrong. It also tracks a drag, where easing
		 * only makes it lag the handle.
		 */
	}
	.weights__mix-note {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.weights__presets {
		display: grid;
		gap: var(--space-2);
	}
	.weights__preset {
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
	.weights__preset:hover {
		border-color: var(--color-border-hover);
		background: var(--color-bg-hover);
	}
	.weights__preset:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.weights__preset--active {
		border-color: var(--color-accent);
		background: var(--color-accent-bg);
	}
	.weights__preset-name {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-weight: 600;
	}
	.weights__preset-tag {
		font-weight: 400;
		color: var(--color-text-muted);
	}
	.weights__preset-note {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.5;
		color: var(--color-text-muted);
	}
</style>
