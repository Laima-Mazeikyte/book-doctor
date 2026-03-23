<script lang="ts">
	import { t } from '$lib/copy';
	import { Search, X } from 'lucide-svelte';

	interface Props {
		value?: string;
		placeholder?: string;
		'aria-label'?: string;
		oninput?: (e: Event) => void;
	}

	let {
		value = $bindable(''),
		placeholder = t('rate.search.placeholder'),
		'aria-label': ariaLabel = t('rate.search.ariaLabel'),
		oninput,
	}: Props = $props();

	function clearSearch() {
		value = '';
	}
</script>

<div class="search-bar">
	<span class="search-bar__icon" aria-hidden="true">
		<Search size={20} />
	</span>
	<input
		type="search"
		autocomplete="off"
		{placeholder}
		aria-label={ariaLabel}
		bind:value
		oninput={oninput}
		class="search-bar__input"
		class:search-bar__input--has-clear={value.length > 0}
	/>
	{#if value.length > 0}
		<button
			type="button"
			class="search-bar__clear"
			aria-label={t('rate.search.clearAriaLabel')}
			onclick={clearSearch}
		>
			<X size={18} aria-hidden="true" />
		</button>
	{/if}
</div>

<style>
	.search-bar {
		position: relative;
	}
	.search-bar__icon {
		position: absolute;
		left: var(--space-4);
		top: 50%;
		transform: translateY(-50%);
		z-index: 1;
		color: var(--color-text-muted);
		pointer-events: none;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.search-bar__clear {
		position: absolute;
		right: var(--space-3);
		top: 50%;
		transform: translateY(-50%);
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--min-tap);
		height: var(--min-tap);
		min-width: var(--min-tap);
		min-height: var(--min-tap);
		padding: 0;
		background: none;
		border: none;
		border-radius: 50%;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default);
	}
	.search-bar__clear:hover {
		color: var(--color-text);
		background: var(--color-bg-muted);
	}
	.search-bar__clear:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	/* Hide native search clear so we only show our single X */
	.search-bar__input::-webkit-search-cancel-button,
	.search-bar__input::-webkit-search-decoration {
		-webkit-appearance: none;
		appearance: none;
	}
	.search-bar__input::-moz-search-cancel-button {
		display: none;
	}
	.search-bar__input[type='search'] {
		-webkit-appearance: none;
		appearance: none;
	}
	.search-bar__input {
		width: 100%;
		min-height: var(--min-tap);
		padding: var(--space-3) var(--space-4) var(--space-3) var(--space-input-icon-left);
		font-family: var(--typ-interactive-1-font-family);
		font-size: var(--typ-interactive-1-font-size);
		font-weight: var(--typ-interactive-1-font-weight);
		line-height: var(--typ-interactive-1-line-height);
		letter-spacing: var(--typ-interactive-1-letter-spacing);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-card-bg);
		color: var(--color-text);
		box-shadow: var(--shadow-input);
		transition: border-color var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default);
	}
	.search-bar__input--has-clear {
		padding-right: calc(var(--space-4) + var(--min-tap) + var(--space-3));
	}
	@media (prefers-color-scheme: dark) {
		.search-bar__input {
			box-shadow: var(--shadow-input);
		}
	}
	.search-bar__input:focus {
		outline: none;
		border-color: var(--color-focus);
		box-shadow: var(--shadow-focus-input);
	}
</style>
