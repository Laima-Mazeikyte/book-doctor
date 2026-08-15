<script lang="ts">
	import { t } from '$lib/copy';
	import { availability, searchAuthors, type AuthorIndex } from '$lib/lab/author-taste/authors';
	import type { Author } from '$lib/lab/author-taste/types';

	interface Props {
		index: AuthorIndex;
		label: string;
		id: string;
		selected?: Author | null;
		/** Keep the label for screen readers but drop it from the layout. */
		hideLabel?: boolean;
		onSelect: (author: Author | null) => void;
	}

	let { index, label, id, selected = null, hideLabel = false, onSelect }: Props = $props();

	let query = $state('');
	let open = $state(false);
	let activeIndex = $state(-1);
	let inputEl: HTMLInputElement | null = $state(null);

	const results = $derived(query.trim().length >= 2 ? searchAuthors(index, query, 10) : []);
	const listId = $derived(`${id}-results`);

	function choose(author: Author): void {
		onSelect(author);
		query = '';
		open = false;
		activeIndex = -1;
	}

	function clear(): void {
		onSelect(null);
		query = '';
		open = false;
		activeIndex = -1;
		inputEl?.focus();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			open = false;
			activeIndex = -1;
			return;
		}
		if (results.length === 0) return;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			open = true;
			activeIndex = (activeIndex + 1) % results.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			open = true;
			activeIndex = (activeIndex - 1 + results.length) % results.length;
		} else if (event.key === 'Enter') {
			const pick = results[activeIndex >= 0 ? activeIndex : 0];
			if (pick) {
				event.preventDefault();
				choose(pick);
			}
		}
	}

	/**
	 * Genre and availability, then what this author actually has to show.
	 *
	 * The map population and the connection population overlap without nesting — 1,240 authors
	 * carry paired evidence but have no coordinates, and 258 sit on the map with no retained
	 * pairs — so a single "assessable" flag would misdescribe both groups. Saying which case
	 * applies here saves a dead-end selection.
	 */
	function describe(author: Author): string {
		const parts = [author.genre];
		const state = availability(author);
		if (state !== 'both') {
			parts.push(t(`lab.authorConnections.availability.${state}`));
		}
		return parts.join(' · ');
	}
</script>

<div class="author-picker">
	<label class="author-picker__label" class:author-picker__label--hidden={hideLabel} for={id}>
		{label}
	</label>

	{#if selected}
		<div class="author-picker__selected">
			<span class="author-picker__selected-name">{selected.name}</span>
			<span class="author-picker__selected-meta">{selected.genre}</span>
			<button type="button" class="btn btn--tertiary btn--compact" onclick={clear}>
				{t('lab.authorConnections.compare.clear')}
			</button>
		</div>
	{:else}
		<div class="author-picker__field">
			<input
				{id}
				bind:this={inputEl}
				bind:value={query}
				type="search"
				class="author-picker__input"
				placeholder={t('lab.authorConnections.compare.placeholder')}
				autocomplete="off"
				role="combobox"
				aria-expanded={open && results.length > 0}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
				oninput={() => {
					open = true;
					activeIndex = -1;
				}}
				onfocus={() => (open = true)}
				onkeydown={handleKeydown}
			/>

			{#if open && query.trim().length >= 2}
				<ul
					class="author-picker__results"
					id={listId}
					role="listbox"
					aria-label={t('lab.authorConnections.compare.resultsLabel')}
				>
					{#if results.length === 0}
						<li class="author-picker__empty">{t('lab.authorConnections.compare.noResults')}</li>
					{:else}
						{#each results as author, i (author.id)}
							<li>
								<button
									type="button"
									id="{listId}-{i}"
									class="author-picker__result"
									class:author-picker__result--active={i === activeIndex}
									role="option"
									aria-selected={i === activeIndex}
									onclick={() => choose(author)}
									onmouseenter={() => (activeIndex = i)}
								>
									<span class="author-picker__result-name">{author.name}</span>
									<span class="author-picker__result-meta">{describe(author)}</span>
								</button>
							</li>
						{/each}
					{/if}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	.author-picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.author-picker__label {
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		color: var(--color-text-muted);
	}
	.author-picker__label--hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
	.author-picker__field {
		position: relative;
		min-width: 0;
	}
	.author-picker__input {
		width: 100%;
		height: var(--min-tap);
		box-sizing: border-box;
		padding: var(--space-1) var(--space-3);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-16);
		line-height: var(--primitive-line-height-interactive);
		color: var(--color-text);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}
	.author-picker__input:focus-visible {
		outline: none;
		border-color: var(--color-focus);
		box-shadow: var(--shadow-focus-input);
	}
	.author-picker__results {
		position: absolute;
		z-index: 5;
		top: calc(100% + var(--space-1));
		left: 0;
		right: 0;
		max-height: 18rem;
		overflow-y: auto;
		margin: 0;
		padding: var(--space-1);
		list-style: none;
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-card-hover);
	}
	.author-picker__result {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		text-align: left;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-radius: var(--radius-xs);
		color: var(--color-text);
		cursor: pointer;
		font-family: var(--font-family-interactive);
	}
	.author-picker__result--active,
	.author-picker__result:hover {
		background: var(--color-interactive-hover-subtle);
	}
	.author-picker__result-name {
		font-size: var(--primitive-type-size-16);
	}
	.author-picker__result-meta,
	.author-picker__selected-meta {
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
	}
	.author-picker__empty {
		padding: var(--space-2) var(--space-3);
		color: var(--color-text-muted);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
	}
	.author-picker__selected {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		height: var(--min-tap);
		box-sizing: border-box;
		min-width: 0;
		flex-wrap: nowrap;
		overflow: hidden;
		padding: var(--space-1) var(--space-3);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}
	.author-picker__selected-name {
		min-width: 0;
		flex: 1 1 auto;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-16);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.author-picker__selected-meta {
		min-width: 0;
		flex: 0 1 auto;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.author-picker__selected button {
		margin-left: auto;
		flex: 0 0 auto;
	}
</style>
