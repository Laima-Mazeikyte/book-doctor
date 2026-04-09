<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		icon?: Snippet;
		variant?: 'primary' | 'secondary' | 'tertiary' | 'inverse' | 'link';
		href?: string;
		type?: 'button' | 'submit';
		disabled?: boolean;
		/** Pill shape (full border-radius) for floating CTAs */
		pill?: boolean;
		/** Compact size (reduced padding) for drawer/secondary actions */
		compact?: boolean;
		id?: string;
		/** Required when using icon-only (no default slot content) for accessibility */
		'aria-label'?: string;
		'aria-expanded'?: boolean;
		'aria-controls'?: string;
		'aria-haspopup'?: boolean | 'false' | 'true' | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog';
		/** Optional callback to receive the underlying button or anchor element (e.g. for focus management) */
		ref?: (el: HTMLButtonElement | HTMLAnchorElement) => void;
		class?: string;
		onclick?: (e: MouseEvent) => void;
	}

	let {
		children,
		icon,
		variant = 'primary',
		href,
		type = 'button',
		disabled = false,
		pill = false,
		compact = false,
		id,
		'aria-label': ariaLabel,
		'aria-expanded': ariaExpanded,
		'aria-controls': ariaControls,
		'aria-haspopup': ariaHaspopup,
		ref,
		class: className = '',
		onclick,
		...rest
	}: Props = $props();

	const isLink = $derived(typeof href === 'string' && href.length > 0);

	let buttonEl = $state<HTMLButtonElement | undefined>(undefined);
	let anchorEl = $state<HTMLAnchorElement | undefined>(undefined);

	$effect(() => {
		const el = isLink ? anchorEl : buttonEl;
		if (el && ref) ref(el);
	});
</script>

{#if isLink}
	<a
		bind:this={anchorEl}
		class="btn btn--{variant} {pill ? 'btn--pill' : ''} {compact ? 'btn--compact' : ''} {className}"
		href={href}
		{id}
		aria-expanded={ariaExpanded}
		aria-controls={ariaControls}
		aria-haspopup={ariaHaspopup}
		aria-label={ariaLabel}
		aria-disabled={disabled ? 'true' : undefined}
		class:btn--disabled={disabled}
		tabindex={disabled ? -1 : undefined}
		{...rest}
		onclick={disabled
			? (e) => {
					e.preventDefault();
				}
			: onclick}
	>
		{#if icon}
			<span class="btn__icon" aria-hidden="true">{@render icon()}</span>
		{/if}
		{#if children}
			<span class="btn__label">{@render children()}</span>
		{/if}
	</a>
{:else}
	<button
		bind:this={buttonEl}
		class="btn btn--{variant} {pill ? 'btn--pill' : ''} {compact ? 'btn--compact' : ''} {className}"
		{id}
		{type}
		disabled={disabled}
		class:btn--disabled={disabled}
		aria-expanded={ariaExpanded}
		aria-controls={ariaControls}
		aria-haspopup={ariaHaspopup}
		aria-label={ariaLabel}
		{...rest}
		onclick={onclick}
	>
		{#if icon}
			<span class="btn__icon" aria-hidden="true">{@render icon()}</span>
		{/if}
		{#if children}
			<span class="btn__label">{@render children()}</span>
		{/if}
	</button>
{/if}
