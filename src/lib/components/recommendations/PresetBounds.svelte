<script lang="ts">
	import type { RangeDraft } from '$lib/recommendations/filteredRecommendations';

	type Preset = { label: string; min?: string; max?: string };
	interface Props {
		id: string;
		label: string;
		hint: string;
		value: RangeDraft;
		presets: Preset[];
		maximum?: number;
		onChange: (next: RangeDraft) => void;
	}

	let { id, label, hint, value, presets, maximum, onChange }: Props = $props();
	let customOpen = $state(false);
	const selectedPreset = $derived(
		presets.findIndex(
			(preset) => (preset.min ?? '') === value.min && (preset.max ?? '') === value.max
		)
	);
	const showCustom = $derived(customOpen || selectedPreset < 0);
	$effect(() => {
		if (value.min === '' && value.max === '') customOpen = false;
	});
</script>

<fieldset class="preset-bounds">
	<legend>{label}</legend>
	<p>{hint}</p>
	<div class="preset-bounds__choices" aria-label={`${label} options`}>
		{#each presets as preset, index (preset.label)}
			<button
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
			type="button"
			class:active={showCustom}
			aria-pressed={showCustom}
			onclick={() => (customOpen = true)}>Custom range</button
		>
	</div>
	{#if showCustom}
		<div class="preset-bounds__custom">
			<label for={`${id}-min`}>
				From
				<input
					id={`${id}-min`}
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
			<label for={`${id}-max`}>
				To
				<input
					id={`${id}-max`}
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
	.preset-bounds legend {
		font-weight: 600;
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
	.preset-bounds__choices button {
		min-height: 2.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-text);
		padding: var(--space-1) var(--space-3);
		cursor: pointer;
	}
	.preset-bounds__choices button.active {
		border-color: var(--color-focus);
		background: var(--color-floating-control-bg);
		font-weight: 600;
	}
	.preset-bounds__custom {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.preset-bounds__custom label {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--typ-caption-font-size);
	}
	.preset-bounds__custom input {
		width: 100%;
		min-height: 2.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		padding: var(--space-2);
	}
</style>
