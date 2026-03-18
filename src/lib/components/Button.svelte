<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		icon?: Snippet;
		variant?: 'primary' | 'secondary' | 'tertiary' | 'inverse' | 'link';
		href?: string;
		type?: 'button' | 'submit';
		/** Pill shape (full border-radius) for floating CTAs */
		pill?: boolean;
		/** Compact size (reduced padding) for drawer/secondary actions */
		compact?: boolean;
		/** Required when using icon-only (no default slot content) for accessibility */
		'aria-label'?: string;
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
		pill = false,
		compact = false,
		'aria-label': ariaLabel,
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
	</a>
{:else}
	<button
		bind:this={buttonEl}
		class="btn btn--{variant} {pill ? 'btn--pill' : ''} {compact ? 'btn--compact' : ''} {className}"
		{type}
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

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: var(--min-tap);
		padding: var(--space-3) var(--space-6);
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-medium);
		line-height: var(--line-height-normal);
		border-radius: var(--radius-sm);
		transition: opacity var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
		cursor: pointer;
		text-decoration: none;
		border: none;
	}
	.btn:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}

	/* Primary */
	.btn--primary {
		background: var(--color-button-primary-bg);
		color: var(--color-button-primary-text);
	}
	.btn--primary:hover {
		opacity: 0.92;
	}

	/* Secondary */
	.btn--secondary {
		background: var(--color-button-secondary-bg);
		color: var(--color-button-secondary-text);
		border: 1px solid var(--color-button-secondary-border);
	}
	.btn--secondary:hover {
		background: var(--color-button-secondary-hover-bg);
		border-color: var(--color-button-secondary-hover-border);
	}

	/* Tertiary */
	.btn--tertiary {
		background: var(--color-button-tertiary-bg);
		color: var(--color-button-tertiary-text);
	}
	.btn--tertiary:hover {
		background: var(--color-button-tertiary-hover-bg);
	}

	/* Inverse: dark on light mode, light on dark mode */
	.btn--inverse {
		background: var(--color-text);
		color: var(--color-bg);
		border: 1px solid var(--color-text);
	}
	.btn--inverse:hover {
		opacity: 0.92;
	}

	/* Link */
	.btn--link {
		background: transparent;
		color: var(--color-button-link-text);
		min-height: auto;
		padding: var(--space-1) var(--space-2);
	}
	.btn--link:hover {
		color: var(--color-button-link-hover-text);
		text-decoration: underline;
	}

	/* Icon-only: square padding */
	.btn:not(:has(.btn__label)) {
		padding: var(--space-3);
	}
	.btn__icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.btn__label {
		display: inline;
	}

	.btn--pill {
		border-radius: var(--radius-pill);
	}
	.btn--compact {
		min-height: 2rem;
		padding: var(--space-2) var(--space-4);
		font-size: var(--font-size-sm);
	}
	.btn--compact:not(:has(.btn__label)) {
		padding: var(--space-2);
	}
</style>
