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
		if (value.min === 0 && value.max === 0.33) return 'low';
		if (value.min === 0.33 && value.max === 0.67) return 'middle';
		if (value.min === 0.67 && value.max === 1) return 'high';
		return 'custom';
	});
	const showCustom = $derived(customOpen || selected === 'custom');
	$effect(() => {
		if (!value.enabled) customOpen = false;
	});

	function choose(which: 'any' | 'low' | 'middle' | 'high') {
		customOpen = false;
		if (which === 'any') onChange({ enabled: false, min: 0, max: 1 });
		if (which === 'low') onChange({ enabled: true, min: 0, max: 0.33 });
		if (which === 'middle') onChange({ enabled: true, min: 0.33, max: 0.67 });
		if (which === 'high') onChange({ enabled: true, min: 0.67, max: 1 });
	}
</script>

<fieldset class="dimension-choices">
	<legend>{dimension.label}</legend>
	<div class="dimension-choices__options">
		{#each [{ key: 'any', label: 'No preference' }, { key: 'low', label: dimension.low }, { key: 'middle', label: 'In between' }, { key: 'high', label: dimension.high }] as option (option.key)}
			<button
				type="button"
				class:active={!customOpen && selected === option.key}
				aria-pressed={!customOpen && selected === option.key}
				onclick={() => choose(option.key as 'any' | 'low' | 'middle' | 'high')}
				>{option.label}</button
			>
		{/each}
		<button
			type="button"
			class:active={showCustom}
			aria-pressed={showCustom}
			onclick={() => {
				customOpen = true;
				if (!value.enabled) onChange({ enabled: true, min: 0, max: 1 });
			}}>Custom</button
		>
	</div>
	{#if showCustom}
		<div class="dimension-choices__custom">
			<label>
				From
				<input
					type="number"
					min="0"
					max="1"
					step="0.01"
					value={value.min}
					oninput={(event) =>
						onChange({ ...value, enabled: true, min: Number(event.currentTarget.value) })}
					onkeydown={(event) => {
						if (event.key === 'Enter') event.preventDefault();
					}}
				/>
			</label>
			<label>
				To
				<input
					type="number"
					min="0"
					max="1"
					step="0.01"
					value={value.max}
					oninput={(event) =>
						onChange({ ...value, enabled: true, max: Number(event.currentTarget.value) })}
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
	.dimension-choices legend {
		font-weight: 600;
	}
	.dimension-choices__options {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.dimension-choices__options button {
		min-height: 2.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-text);
		padding: var(--space-1) var(--space-3);
		cursor: pointer;
	}
	.dimension-choices__options button.active {
		border-color: var(--color-focus);
		background: var(--color-floating-control-bg);
		font-weight: 600;
	}
	.dimension-choices__custom {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.dimension-choices__custom label {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--typ-caption-font-size);
	}
	.dimension-choices__custom input {
		width: 100%;
		min-height: 2.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		padding: var(--space-2);
	}
</style>
