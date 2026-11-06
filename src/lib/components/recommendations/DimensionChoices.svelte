<script lang="ts">
	import type {
		DimensionDraft,
		FILTER_DIMENSIONS
	} from '$lib/recommendations/filteredRecommendations';

	interface Props {
		dimension: (typeof FILTER_DIMENSIONS)[number];
		value: DimensionDraft;
		onChange: (next: DimensionDraft) => void;
	}

	let { dimension, value, onChange }: Props = $props();
	let customOpen = $state(false);
	const selected = $derived.by(() => {
		if (!value.enabled) return 'any';
		if (value.min === '0' && value.max === '0.33') return 'low';
		if (value.min === '0.33' && value.max === '0.67') return 'middle';
		if (value.min === '0.67' && value.max === '1') return 'high';
		return 'custom';
	});
	const showCustom = $derived(customOpen || selected === 'custom');
	$effect(() => {
		if (!value.enabled) customOpen = false;
	});

	function choose(which: 'any' | 'low' | 'middle' | 'high') {
		customOpen = false;
		if (which === 'any') onChange({ enabled: false, min: '0', max: '1' });
		if (which === 'low') onChange({ enabled: true, min: '0', max: '0.33' });
		if (which === 'middle') onChange({ enabled: true, min: '0.33', max: '0.67' });
		if (which === 'high') onChange({ enabled: true, min: '0.67', max: '1' });
	}
</script>

<fieldset class="dimension-choices">
	<legend class="recommendation-filter-label">{dimension.label}</legend>
	<div class="dimension-choices__options">
		{#each [{ key: 'any', label: 'No preference' }, { key: 'low', label: dimension.low }, { key: 'middle', label: 'In between' }, { key: 'high', label: dimension.high }] as option (option.key)}
			<button
				class="recommendation-filter-choice"
				type="button"
				class:active={!customOpen && selected === option.key}
				aria-pressed={!customOpen && selected === option.key}
				onclick={() => choose(option.key as 'any' | 'low' | 'middle' | 'high')}
				>{option.label}</button
			>
		{/each}
		<button
			class="recommendation-filter-choice"
			type="button"
			class:active={showCustom}
			aria-pressed={showCustom}
			onclick={() => {
				customOpen = true;
				if (!value.enabled) onChange({ enabled: true, min: '0', max: '1' });
			}}>Custom</button
		>
	</div>
	{#if showCustom}
		<p class="dimension-choices__hint" id={`dimension-${dimension.key}-hint`}>
			Scale: 0 = {dimension.low}; 1 = {dimension.high}.
		</p>
		<div class="dimension-choices__custom">
			<label class="recommendation-filter-label">
				From
				<input
					class="recommendation-filter-input"
					type="number"
					aria-describedby={`dimension-${dimension.key}-hint`}
					min="0"
					max="1"
					step="0.01"
					required
					value={value.min}
					oninput={(event) => onChange({ ...value, enabled: true, min: event.currentTarget.value })}
					onkeydown={(event) => {
						if (event.key === 'Enter') event.preventDefault();
					}}
				/>
			</label>
			<label class="recommendation-filter-label">
				To
				<input
					class="recommendation-filter-input"
					type="number"
					aria-describedby={`dimension-${dimension.key}-hint`}
					min="0"
					max="1"
					step="0.01"
					required
					value={value.max}
					oninput={(event) => onChange({ ...value, enabled: true, max: event.currentTarget.value })}
					onkeydown={(event) => {
						if (event.key === 'Enter') event.preventDefault();
					}}
				/>
			</label>
		</div>
	{/if}
</fieldset>

<style>
	.dimension-choices {
		border: 0;
		border-bottom: 1px solid var(--color-border);
		padding: var(--space-3) 0;
		margin: 0;
	}

	.dimension-choices__options {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.dimension-choices__custom {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.dimension-choices__hint {
		margin: var(--space-2) 0 0;
		color: var(--color-text-muted);
		font-size: var(--typ-caption-font-size);
	}
	.dimension-choices__custom label {
		min-width: 0;
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-1);
	}
</style>
