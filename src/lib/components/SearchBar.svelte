<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { t } from '$lib/copy';
	import { Search } from 'lucide-svelte';

	interface Props {
		value?: string;
		placeholder?: string;
		'aria-label'?: string;
		oninput?: (e: Event) => void;
		/** Request focus when this instance mounts (e.g. rate search overlay field). */
		autofocus?: boolean;
		/**
		 * Renders a button styled like the field (toolbar affordance); real typing happens elsewhere (e.g. overlay).
		 */
		asTrigger?: boolean;
		/** Click / Enter / Space on the trigger (when `asTrigger` is true). */
		onActivate?: () => void;
	}

	let {
		value = $bindable(''),
		placeholder = t('rate.search.placeholder'),
		'aria-label': ariaLabel = t('rate.search.ariaLabel'),
		oninput,
		autofocus = false,
		asTrigger = false,
		onActivate,
	}: Props = $props();

	let inputRef: HTMLInputElement | undefined = $state();
	let triggerRef: HTMLButtonElement | undefined = $state();

	const triggerShowsPlaceholder = $derived(asTrigger && !value.trim());

	/** Focus the input or the trigger button. */
	export function focusInput() {
		if (asTrigger) {
			triggerRef?.focus();
		} else {
			inputRef?.focus();
		}
	}

	function clearSearch() {
		value = '';
	}

	onMount(() => {
		if (!autofocus || asTrigger) return;
		void tick().then(() => inputRef?.focus());
	});
</script>

<div class="search-bar">
	<span class="search-bar__icon" aria-hidden="true">
		<Search size={20} />
	</span>
	{#if asTrigger}
		<button
			bind:this={triggerRef}
			type="button"
			class="search-bar__trigger"
			aria-label={ariaLabel}
			onclick={() => onActivate?.()}
		>
			<span
				class="search-bar__trigger-text"
				class:search-bar__trigger-text--placeholder={triggerShowsPlaceholder}
			>
				{triggerShowsPlaceholder ? placeholder : value}
			</span>
		</button>
	{:else}
		<input
			bind:this={inputRef}
			type="text"
			inputmode="search"
			role="searchbox"
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
				<span class="search-bar__clear-label">{t('rate.search.clear')}</span>
			</button>
		{/if}
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		min-height: var(--min-tap);
		padding: var(--space-2) var(--space-3);
		background: none;
		border: none;
		border-radius: var(--radius-pill);
		color: var(--color-text-muted);
		font-family: var(--typ-interactive-1-font-family);
		font-size: var(--typ-interactive-1-font-size);
		font-weight: var(--typ-interactive-1-font-weight);
		line-height: var(--typ-interactive-1-line-height);
		letter-spacing: var(--typ-interactive-1-letter-spacing);
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default);
	}
	.search-bar__clear-label {
		white-space: nowrap;
	}
	.search-bar__clear:hover {
		color: var(--color-text);
		background: var(--color-bg-muted);
	}
	.search-bar__clear:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.search-bar__input {
		width: 100%;
		min-height: var(--min-tap);
		padding: var(--space-3) var(--space-4) var(--space-3) var(--space-input-icon-left);
		font-family: var(--typ-interactive-1-font-family);
		font-size: var(--primitive-type-size-16);
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
		padding-right: calc(var(--space-4) + 5.5rem + var(--space-3));
	}
	.search-bar__input:focus {
		outline: none;
		border-color: var(--color-focus);
		box-shadow: var(--shadow-focus-input);
	}

	/*
	 * Single clear control: we render `.search-bar__clear`. If `type="search"` is ever used again,
	 * hide native cancel/decoration (WebKit/Firefox/legacy Edge) so it never stacks with ours.
	 */
	.search-bar__input::-webkit-search-cancel-button,
	.search-bar__input::-webkit-search-decoration,
	.search-bar__input::-webkit-search-results-button,
	.search-bar__input::-webkit-search-results-decoration {
		-webkit-appearance: none;
		appearance: none;
		display: none;
	}
	.search-bar__input::-moz-search-cancel-button {
		display: none;
	}
	.search-bar__input::-ms-clear {
		display: none;
	}

	.search-bar__trigger {
		box-sizing: border-box;
		display: flex;
		align-items: center;
		width: 100%;
		min-height: var(--min-tap);
		margin: 0;
		padding: var(--space-3) var(--space-4) var(--space-3) var(--space-input-icon-left);
		font-family: var(--typ-interactive-1-font-family);
		font-size: var(--primitive-type-size-16);
		font-weight: var(--typ-interactive-1-font-weight);
		line-height: var(--typ-interactive-1-line-height);
		letter-spacing: var(--typ-interactive-1-letter-spacing);
		text-align: left;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-card-bg);
		color: var(--color-text);
		box-shadow: var(--shadow-input);
		cursor: pointer;
		transition: border-color var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default);
	}
	.search-bar__trigger:hover {
		border-color: var(--color-border-hover);
	}
	.search-bar__trigger:focus {
		outline: none;
		border-color: var(--color-focus);
		box-shadow: var(--shadow-focus-input);
	}
	.search-bar__trigger:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.search-bar__trigger-text {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.search-bar__trigger-text--placeholder {
		color: var(--color-text-muted);
		font-weight: var(--typ-interactive-1-font-weight);
	}
</style>
