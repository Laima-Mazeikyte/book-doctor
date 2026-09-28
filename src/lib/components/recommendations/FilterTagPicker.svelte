<script lang="ts">
	interface Props {
		id: string;
		label: string;
		options: string[];
		selected: string[];
		onChange: (next: string[]) => void;
		mode?: 'any_of' | 'all_of';
		onModeChange?: (next: 'any_of' | 'all_of') => void;
		minimumQueryLength?: number;
		onQueryChange?: (query: string) => void;
		loading?: boolean;
		error?: string;
		preFiltered?: boolean;
	}

	let {
		id,
		label,
		options,
		selected,
		onChange,
		mode = 'any_of',
		onModeChange,
		minimumQueryLength = 1,
		onQueryChange,
		loading = false,
		error = '',
		preFiltered = false
	}: Props = $props();
	let query = $state('');
	const suggestions = $derived(
		query.trim().length < minimumQueryLength
			? []
			: options
					.filter(
						(option) =>
							preFiltered || option.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
					)
					.filter((option) => !selected.includes(option))
					.slice(0, 24)
	);

	function select(option: string) {
		if (selected.includes(option)) return;
		onChange([...selected, option]);
		query = '';
		onQueryChange?.('');
	}

	function remove(option: string) {
		onChange(selected.filter((value) => value !== option));
	}
</script>

<div class="filter-picker">
	<div class="filter-picker__heading">
		<label for={id}>{label}</label>
		{#if onModeChange}
			<select
				aria-label={`${label} matching rule`}
				value={mode}
				onchange={(event) => onModeChange?.(event.currentTarget.value as 'any_of' | 'all_of')}
			>
				<option value="any_of">Match any</option>
				<option value="all_of">Match all</option>
			</select>
		{/if}
	</div>
	{#if selected.length}
		<div class="filter-picker__chips" aria-label={`Selected ${label.toLowerCase()}`}>
			{#each selected as value (value)}
				<button
					type="button"
					class="filter-picker__chip"
					onclick={() => remove(value)}
					aria-label={`Remove ${value}`}
				>
					{value} <span aria-hidden="true">×</span>
				</button>
			{/each}
		</div>
	{/if}
	<input
		{id}
		type="search"
		autocomplete="off"
		placeholder={`Search ${label.toLowerCase()}`}
		bind:value={query}
		oninput={(event) => onQueryChange?.(event.currentTarget.value)}
		onkeydown={(event) => {
			if (event.key !== 'Enter') return;
			event.preventDefault();
			if (suggestions.length) select(suggestions[0]);
		}}
	/>
	{#if loading}
		<p class="filter-picker__hint">Searching…</p>
	{:else if error}
		<p class="filter-picker__error" role="alert">{error}</p>
	{:else if query.trim().length < minimumQueryLength}
		<p class="filter-picker__hint">
			Type at least {minimumQueryLength}
			{minimumQueryLength === 1 ? 'character' : 'characters'}.
		</p>
	{:else if suggestions.length}
		<div class="filter-picker__options" role="group" aria-label={`${label} suggestions`}>
			{#each suggestions as option (option)}
				<button type="button" onclick={() => select(option)}>{option}</button>
			{/each}
		</div>
	{:else if query.trim()}
		<p class="filter-picker__hint">No matching {label.toLowerCase()}.</p>
	{/if}
</div>

<style>
	.filter-picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.filter-picker__heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.filter-picker__heading label {
		font-weight: 600;
	}
	.filter-picker__heading select,
	.filter-picker input {
		min-height: 2.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		padding: var(--space-2);
	}
	.filter-picker input {
		width: 100%;
	}
	.filter-picker__chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.filter-picker__chip {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-floating-control-bg);
		color: var(--color-text);
		padding: var(--space-1) var(--space-2);
		cursor: pointer;
	}
	.filter-picker__options {
		display: flex;
		flex-direction: column;
		max-height: 12rem;
		overflow-y: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}
	.filter-picker__options button {
		min-height: 2.5rem;
		border: 0;
		border-bottom: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		padding: var(--space-2);
		text-align: left;
		cursor: pointer;
	}
	.filter-picker__options button:hover,
	.filter-picker__options button:focus-visible {
		background: var(--color-floating-control-bg);
	}
	.filter-picker__hint {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--typ-caption-font-size);
	}
	.filter-picker__error {
		margin: 0;
		color: var(--color-error-text);
		font-size: var(--typ-caption-font-size);
	}
</style>
