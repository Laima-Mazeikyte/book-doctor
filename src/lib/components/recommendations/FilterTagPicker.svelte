<script lang="ts">
	interface Props {
		id: string;
		label: string;
		options: string[];
		selected: string[];
		onChange: (next: string[]) => void;
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
		minimumQueryLength = 1,
		onQueryChange,
		loading = false,
		error = '',
		preFiltered = false
	}: Props = $props();
	let query = $state('');
	let activeIndex = $state(-1);
	let dismissed = $state(false);
	let input: HTMLInputElement;
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
	const expanded = $derived(!dismissed && !loading && !error && suggestions.length > 0);
	const activeDescendant = $derived(
		expanded && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
	);
	$effect(() => {
		void query;
		dismissed = false;
	});
	$effect(() => {
		void suggestions;
		activeIndex = -1;
	});
	$effect(() => {
		if (activeDescendant)
			document.getElementById(activeDescendant)?.scrollIntoView({ block: 'nearest' });
	});

	function select(option: string) {
		if (selected.includes(option)) return;
		onChange([...selected, option]);
		query = '';
		onQueryChange?.('');
		input?.focus({ preventScroll: true });
	}

	function remove(option: string) {
		onChange(selected.filter((value) => value !== option));
	}

	function handleKeydown(event: KeyboardEvent) {
		if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length && !loading) {
			event.preventDefault();
			dismissed = false;
			activeIndex =
				event.key === 'ArrowDown'
					? (activeIndex + 1) % suggestions.length
					: activeIndex < 0
						? suggestions.length - 1
						: (activeIndex - 1 + suggestions.length) % suggestions.length;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (expanded) select(suggestions[activeIndex < 0 ? 0 : activeIndex]);
		} else if (event.key === 'Escape' && !dismissed && (expanded || loading)) {
			event.preventDefault();
			event.stopPropagation();
			dismissed = true;
		}
	}
</script>

<div class="filter-picker">
	<div class="filter-picker__heading">
		<label class="recommendation-filter-label" for={id}>{label}</label>
	</div>
	{#if selected.length}
		<div class="filter-picker__chips" aria-label={`Selected ${label.toLowerCase()}`}>
			{#each selected as value (value)}
				<button
					type="button"
					class="filter-picker__chip recommendation-filter-choice active"
					onclick={() => remove(value)}
					aria-label={`Remove ${value}`}
				>
					{value} <span aria-hidden="true">×</span>
				</button>
			{/each}
		</div>
	{/if}
	<input
		class="recommendation-filter-input"
		bind:this={input}
		{id}
		type="search"
		role="combobox"
		aria-autocomplete="list"
		aria-expanded={expanded}
		aria-controls={expanded ? `${id}-suggestions` : undefined}
		aria-activedescendant={activeDescendant}
		autocomplete="off"
		placeholder={`Search ${label.toLowerCase()}`}
		bind:value={query}
		oninput={(event) => onQueryChange?.(event.currentTarget.value)}
		onkeydown={handleKeydown}
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
	{:else if expanded}
		<div
			class="filter-picker__options scrollbar-subtle"
			id={`${id}-suggestions`}
			role="listbox"
			aria-label={`${label} suggestions`}
		>
			{#each suggestions as option, index (option)}
				<button
					type="button"
					role="option"
					id={`${id}-option-${index}`}
					aria-selected={activeIndex === index}
					tabindex="-1"
					onclick={() => select(option)}
					onkeydown={handleKeydown}>{option}</button
				>
			{/each}
		</div>
	{:else if query.trim() && !dismissed}
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

	.filter-picker__chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
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
		min-height: var(--min-tap);
		border: 0;
		border-bottom: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		padding: var(--space-2);
		text-align: left;
		cursor: pointer;
	}
	.filter-picker__options button:hover,
	.filter-picker__options button:focus-visible,
	.filter-picker__options button[aria-selected='true'] {
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
