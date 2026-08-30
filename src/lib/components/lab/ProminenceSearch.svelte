<script lang="ts">
	import ScreenReaderOnly from '$lib/components/ScreenReaderOnly.svelte';

	interface Props {
		count: number;
		names: string[];
		rankByIndex: ArrayLike<number>;
		matches: number[];
		query: string;
		focused: boolean;
		activeOption: number;
		onQuery: (value: string) => void;
		onFocus: () => void;
		onClose: () => void;
		onMove: (index: number) => void;
		onSelect: (index: number) => void;
		onClear: () => void;
	}

	let {
		count,
		names,
		rankByIndex,
		matches,
		query,
		focused,
		activeOption,
		onQuery,
		onFocus,
		onClose,
		onMove,
		onSelect,
		onClear
	}: Props = $props();
	let region: HTMLDivElement | null = $state(null);
	let statusText = $state('');
	let statusTimer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		void focused;
		void query;
		void matches;
		if (statusTimer !== null) clearTimeout(statusTimer);
		statusTimer = setTimeout(() => {
			statusText = focused && query.trim().length > 0 ? `${matches.length} author matches.` : '';
			statusTimer = null;
		}, 180);
		return () => {
			if (statusTimer !== null) clearTimeout(statusTimer);
			statusTimer = null;
		};
	});

	$effect(() => {
		const index = focused && activeOption >= 0 ? matches[activeOption] : undefined;
		if (index === undefined || typeof document === 'undefined') return;
		document.getElementById(`author-option-${index}`)?.scrollIntoView({ block: 'nearest' });
	});

	function handleKeydown(event: KeyboardEvent): void {
		const popupOpen = focused && matches.length > 0;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (popupOpen) {
				event.preventDefault();
				const direction = event.key === 'ArrowDown' ? 1 : -1;
				const next =
					activeOption < 0 ? (direction > 0 ? 0 : matches.length - 1) : activeOption + direction;
				onMove((next + matches.length) % matches.length);
			}
		} else if ((event.key === 'Home' || event.key === 'End') && popupOpen) {
			event.preventDefault();
			onMove(event.key === 'Home' ? 0 : matches.length - 1);
		} else if (event.key === 'Enter' && popupOpen && activeOption >= 0) {
			event.preventDefault();
			const index = matches[activeOption];
			if (index !== undefined) onSelect(index);
		} else if (event.key === 'Escape' && focused) {
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}
	}

	function handleFocusOut(event: FocusEvent): void {
		if (!region?.contains(event.relatedTarget as Node | null)) onClose();
	}
</script>

<div class="prominence-search" bind:this={region} onfocusout={handleFocusOut}>
	<div class="prominence-search__input">
		<svg aria-hidden="true" viewBox="0 0 20 20"
			><circle cx="8.5" cy="8.5" r="5.25"></circle><path d="m12.5 12.5 4 4"></path></svg
		>
		<input
			id="author-search"
			type="search"
			role="combobox"
			aria-label="Author search"
			autocomplete="off"
			placeholder={`Search ${count.toLocaleString()} authors...`}
			aria-autocomplete="list"
			aria-expanded={focused && matches.length > 0}
			aria-controls="author-search-results"
			aria-haspopup="listbox"
			aria-activedescendant={focused && activeOption >= 0 && matches[activeOption] !== undefined
				? `author-option-${matches[activeOption]}`
				: undefined}
			value={query}
			onfocus={onFocus}
			oninput={(event) => onQuery(event.currentTarget.value)}
			onkeydown={handleKeydown}
		/>
		{#if query}<button type="button" aria-label="Clear author search" onclick={onClear}>×</button
			>{/if}
	</div>
	{#if focused && matches.length > 0}
		<ul
			id="author-search-results"
			class="prominence-search__results"
			role="listbox"
			aria-label="Eligible author matches"
		>
			{#each matches as index, optionIndex (index)}
				<li role="presentation">
					<button
						type="button"
						role="option"
						tabindex="-1"
						id="author-option-{index}"
						aria-selected={activeOption === optionIndex}
						aria-posinset={optionIndex + 1}
						aria-setsize={matches.length}
						aria-label={`${names[index]}, rank ${rankByIndex[index] || 'unranked'} of ${count.toLocaleString()}`}
						class:active={activeOption === optionIndex}
						onmousedown={(event) => event.preventDefault()}
						onclick={() => onSelect(index)}
						><span>{names[index]}</span><small
							>#{rankByIndex[index] || '—'} of {count.toLocaleString()}</small
						>
					</button>
				</li>
			{/each}
		</ul>
	{:else if focused && query.trim().length > 0}
		<p class="prominence-search__empty">No matching eligible authors.</p>
	{/if}
	<ScreenReaderOnly aria-live="polite" aria-atomic="true">{statusText}</ScreenReaderOnly>
</div>

<style>
	.prominence-search {
		position: relative;
		margin: 16px 0;
	}
	.prominence-search__input {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 0 11px;
		border: 1px solid rgba(164, 204, 206, 0.24);
		border-radius: 8px;
		background: rgba(14, 27, 27, 0.7);
	}
	.prominence-search__input:focus-within {
		border-color: rgba(207, 231, 232, 0.7);
		box-shadow: 0 0 0 3px rgba(57, 197, 150, 0.1);
	}
	.prominence-search__input svg {
		width: 17px;
		height: 17px;
		flex: 0 0 auto;
		fill: none;
		stroke: rgba(207, 231, 232, 0.6);
		stroke-width: 1.5;
	}
	.prominence-search input {
		min-width: 0;
		flex: 1;
		padding: 8px 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: #efffff;
		font: 13px var(--font-family-interactive);
	}
	.prominence-search__input > button {
		min-width: 44px;
		min-height: 44px;
		border: 0;
		background: transparent;
		color: rgba(207, 231, 232, 0.7);
		font-size: 22px;
		cursor: pointer;
	}
	.prominence-search__results {
		position: absolute;
		z-index: 8;
		right: 0;
		left: 0;
		display: grid;
		gap: 2px;
		margin: 4px 0 0;
		padding: 5px;
		border: 1px solid rgba(164, 204, 206, 0.2);
		border-radius: 8px;
		background: #102020;
		box-shadow: 0 15px 35px rgba(0, 0, 0, 0.3);
		list-style: none;
	}
	.prominence-search__results button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		min-height: 44px;
		padding: 9px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: #cfe7e8;
		text-align: left;
		cursor: pointer;
		font: 12px var(--font-family-interactive);
	}
	.prominence-search__results button:hover,
	.prominence-search__results button.active {
		background: rgba(57, 197, 150, 0.12);
		color: #efffff;
	}
	.prominence-search__results small {
		color: rgba(207, 231, 232, 0.55);
		font-size: 11px;
		white-space: nowrap;
	}
	.prominence-search__empty {
		margin: 8px 0;
		color: rgba(207, 231, 232, 0.62);
		font: 12px var(--font-family-interactive);
	}
	@media (min-width: 901px) {
		.prominence-search {
			margin-top: 0;
		}
	}
</style>
