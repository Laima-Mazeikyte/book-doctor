<script lang="ts">
	import {
		relativeDimensionLabel,
		type FilterDimension
	} from '$lib/recommendations/filteredRecommendations';
	let {
		dimension,
		value,
		onChange
	}: {
		dimension: { key: FilterDimension; label: string };
		value: number | undefined;
		onChange: (next: number | undefined) => void;
	} = $props();
</script>

<fieldset>
	<legend class="recommendation-filter-label">{dimension.label}</legend>
	<div class="choices">
		<button
			class="recommendation-filter-choice"
			type="button"
			class:active={value === undefined}
			aria-pressed={value === undefined}
			onclick={() => onChange(undefined)}>No change</button
		>
		{#each [-1, 1] as direction (direction)}
			<button
				class="recommendation-filter-choice"
				type="button"
				class:active={value !== undefined && Math.sign(value) === direction}
				aria-pressed={value !== undefined && Math.sign(value) === direction}
				onclick={() => onChange(direction * Math.abs(value ?? 0.15))}
				>{relativeDimensionLabel(dimension.key, direction)}</button
			>
		{/each}
	</div>
</fieldset>

<style>
	fieldset {
		border: 0;
		border-bottom: 1px solid var(--color-border);
		padding: var(--space-3) 0;
		margin: 0;
		min-width: 0;
	}

	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
</style>
