<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		href?: string;
		onclick?: (e: MouseEvent) => void;
		'aria-label'?: string;
	}

	let { children, href, onclick, 'aria-label': ariaLabel }: Props = $props();
</script>

{#if href}
	<a class="app-header__mobile-menu-action" {href} {onclick}>{@render children()}</a>
{:else}
	<button type="button" class="app-header__mobile-menu-action" {onclick} aria-label={ariaLabel}
		>{@render children()}</button>
{/if}

<style>
	.app-header__mobile-menu-action {
		display: inline-flex;
		align-items: center;
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
		text-decoration: none;
		white-space: nowrap;
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
		border-radius: var(--radius-pill);
		transition: color 0.15s ease, background 0.15s ease;
	}
	.app-header__mobile-menu-action:hover {
		color: var(--color-text);
		background: var(--color-interactive-hover-subtle);
	}
	.app-header__mobile-menu-action:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	button.app-header__mobile-menu-action {
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}
</style>
