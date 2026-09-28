<script lang="ts">
	interface Props {
		id: string;
		label: string;
		options: string[];
		featured: string[];
		selected: string[];
		onChange: (next: string[]) => void;
		mode: 'any_of' | 'all_of';
		onModeChange: (next: 'any_of' | 'all_of') => void;
	}

	let { id, label, options, featured, selected, onChange, mode, onModeChange }: Props = $props();
	let dialog: HTMLDialogElement;
	let searchInput: HTMLInputElement;
	let query = $state('');
	const visibleOptions = $derived(
		options.filter((option) =>
			option.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
		)
	);
	const featuredOptions = $derived(
		featured.filter((option) => options.includes(option) && !selected.includes(option))
	);

	function toggle(option: string) {
		onChange(
			selected.includes(option)
				? selected.filter((value) => value !== option)
				: [...selected, option]
		);
	}

	function openDialog() {
		query = '';
		dialog.showModal();
		requestAnimationFrame(() => searchInput?.focus());
	}
</script>

<section class="browse-picker" aria-labelledby={`${id}-heading`}>
	<div class="browse-picker__heading">
		<h3 id={`${id}-heading`}>{label}</h3>
		<button type="button" class="browse-picker__browse" onclick={openDialog}>Browse all</button>
	</div>
	{#if featuredOptions.length}
		<div class="browse-picker__featured" aria-label={`Explore ${label.toLowerCase()}`}>
			{#each featuredOptions as option (option)}
				<button type="button" onclick={() => toggle(option)}>{option}</button>
			{/each}
		</div>
	{/if}
	{#if selected.length}
		<div class="browse-picker__selected" aria-label={`Selected ${label.toLowerCase()}`}>
			{#each selected as option (option)}
				<button type="button" onclick={() => toggle(option)} aria-label={`Remove ${option}`}>
					{option} <span aria-hidden="true">×</span>
				</button>
			{/each}
		</div>
	{/if}
	{#if selected.length > 1}
		<label class="browse-picker__mode" for={`${id}-mode`}>
			<span>How should these match?</span>
			<select
				id={`${id}-mode`}
				value={mode}
				onchange={(event) => onModeChange(event.currentTarget.value as 'any_of' | 'all_of')}
			>
				<option value="any_of">Match any selected</option>
				<option value="all_of">Match all selected</option>
			</select>
		</label>
	{/if}
</section>

<dialog bind:this={dialog} class="browse-picker__dialog" aria-labelledby={`${id}-dialog-heading`}>
	<div class="browse-picker__dialog-header">
		<div>
			<h2 id={`${id}-dialog-heading`} class="typ-h3">Choose {label.toLowerCase()}</h2>
			<p>Select any number of labels. Your search starts when you press Find books.</p>
		</div>
		<button
			type="button"
			class="browse-picker__close"
			aria-label="Close"
			onclick={() => dialog.close()}>×</button
		>
	</div>
	<label class="browse-picker__search" for={`${id}-search`}>
		Search {label.toLowerCase()}
		<input
			id={`${id}-search`}
			bind:this={searchInput}
			type="search"
			autocomplete="off"
			bind:value={query}
			onkeydown={(event) => {
				if (event.key === 'Enter') event.preventDefault();
			}}
		/>
	</label>
	<p class="browse-picker__count">{visibleOptions.length} {label.toLowerCase()} available</p>
	<div class="browse-picker__list" role="group" aria-label={`All ${label.toLowerCase()}`}>
		{#each visibleOptions as option (option)}
			<label>
				<input
					type="checkbox"
					checked={selected.includes(option)}
					onchange={() => toggle(option)}
				/>
				<span>{option}</span>
			</label>
		{:else}
			<p>No matching labels. Try another word.</p>
		{/each}
	</div>
	<div class="browse-picker__dialog-actions">
		<span>{selected.length} selected</span>
		<button type="button" class="btn btn--primary" onclick={() => dialog.close()}>Done</button>
	</div>
</dialog>

<style>
	.browse-picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.browse-picker__heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.browse-picker__heading h3 {
		margin: 0;
		font-size: var(--typ-body-font-size);
	}
	.browse-picker__browse {
		border: 0;
		background: transparent;
		color: var(--color-text);
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
		white-space: nowrap;
	}
	.browse-picker__featured,
	.browse-picker__selected {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.browse-picker__featured button,
	.browse-picker__selected button {
		min-height: 2.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-text);
		padding: var(--space-1) var(--space-3);
		cursor: pointer;
	}
	.browse-picker__featured button:hover,
	.browse-picker__featured button:focus-visible {
		border-color: var(--color-focus);
	}
	.browse-picker__selected button {
		background: var(--color-floating-control-bg);
		border-color: var(--color-focus);
	}
	.browse-picker__mode {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--typ-caption-font-size);
	}
	.browse-picker__mode select,
	.browse-picker__search input {
		min-height: 2.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		padding: var(--space-2);
	}
	.browse-picker__dialog {
		width: min(34rem, calc(100vw - 2rem));
		max-height: min(42rem, calc(100dvh - 2rem));
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-bg);
		color: var(--color-text);
		padding: var(--space-4);
		box-shadow: 0 1rem 3rem rgb(0 0 0 / 20%);
	}
	.browse-picker__dialog[open] {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.browse-picker__dialog::backdrop {
		background: rgb(0 0 0 / 55%);
	}
	.browse-picker__dialog-header {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.browse-picker__dialog-header h2,
	.browse-picker__dialog-header p,
	.browse-picker__count {
		margin: 0;
	}
	.browse-picker__dialog-header p,
	.browse-picker__count {
		color: var(--color-text-muted);
		font-size: var(--typ-caption-font-size);
	}
	.browse-picker__close {
		align-self: start;
		border: 0;
		background: transparent;
		color: var(--color-text);
		font-size: 1.5rem;
		cursor: pointer;
	}
	.browse-picker__search {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-weight: 600;
	}
	.browse-picker__list {
		min-height: 4rem;
		overflow-y: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}
	.browse-picker__list label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		border-bottom: 1px solid var(--color-border);
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
	}
	.browse-picker__list label:hover {
		background: var(--color-floating-control-bg);
	}
	.browse-picker__list p {
		padding: var(--space-3);
	}
	.browse-picker__dialog-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
</style>
