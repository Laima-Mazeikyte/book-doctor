<script lang="ts">
	import type { RangeDraft, RangePreset } from '$lib/recommendations/filteredRecommendations';
	interface Props {
		id: string;
		label: string;
		customHint?: string;
		value: RangeDraft;
		presets: RangePreset[];
		maximum?: number;
		onChange: (next: RangeDraft) => void;
	}

	let { id, label, customHint, value, presets, maximum, onChange }: Props = $props();
	let customOpen = $state(false);
	const selectedPreset = $derived(
		presets.findIndex(
			(preset) => (preset.min ?? '') === value.min && (preset.max ?? '') === value.max
		)
	);
	const showCustom = $derived(customOpen || selectedPreset < 0);
</script>

<fieldset class="preset-bounds">
	<legend class="recommendation-filter-label">{label}</legend>
	<div class="preset-bounds__choices" aria-label={`${label} options`}>
		{#each presets as preset, index (preset.label)}
			<button
				class="recommendation-filter-choice"
				type="button"
				class:active={!customOpen && selectedPreset === index}
				aria-pressed={!customOpen && selectedPreset === index}
				onclick={() => {
					customOpen = false;
					onChange({ min: preset.min ?? '', max: preset.max ?? '' });
				}}>{preset.label}</button
			>
		{/each}
		<button
			class="recommendation-filter-choice"
			type="button"
			class:active={showCustom}
			aria-pressed={showCustom}
			onclick={() => (customOpen = true)}>Custom range</button
		>
	</div>
	{#if showCustom}
		{#if customHint}<p id={`${id}-custom-hint`}>{customHint}</p>{/if}
		<div class="preset-bounds__custom">
			<label class="recommendation-filter-label" for={`${id}-min`}>
				From
				<input
					class="recommendation-filter-input"
					id={`${id}-min`}
					aria-describedby={customHint ? `${id}-custom-hint` : undefined}
					type="number"
					min={maximum === 100 ? 0 : 1}
					max={maximum}
					step="1"
					value={value.min}
					oninput={(event) => onChange({ ...value, min: event.currentTarget.value })}
					onkeydown={(event) => {
						if (event.key === 'Enter') event.preventDefault();
					}}
				/>
			</label>
			<label class="recommendation-filter-label" for={`${id}-max`}>
				To
				<input
					class="recommendation-filter-input"
					id={`${id}-max`}
					aria-describedby={customHint ? `${id}-custom-hint` : undefined}
					type="number"
					min={maximum === 100 ? 0 : 1}
					max={maximum}
					step="1"
					value={value.max}
					oninput={(event) => onChange({ ...value, max: event.currentTarget.value })}
					onkeydown={(event) => {
						if (event.key === 'Enter') event.preventDefault();
					}}
				/>
			</label>
		</div>
	{/if}
</fieldset>

<style>
	.preset-bounds {
		border: 0;
		padding: 0;
		margin: 0;
	}

	.preset-bounds p {
		margin: var(--space-1) 0 var(--space-2);
		color: var(--color-text-muted);
		font-size: var(--typ-caption-font-size);
	}
	.preset-bounds__choices {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.preset-bounds__custom {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.preset-bounds__custom label {
		min-width: 0;
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-1);
	}
</style>
