<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { hideCoversStore } from '$lib/stores/hideCovers';

	const STORAGE_KEY = 'book-doctor-hide-covers';

	let { children } = $props();

	onMount(() => {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'true') {
			hideCoversStore.set(true);
		}
	});

	function handleHideCoversChange(checked: boolean) {
		hideCoversStore.set(checked);
		localStorage.setItem(STORAGE_KEY, String(checked));
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<a href="#main" class="skip-link">Skip to main content</a>
<header class="app-header">
	<div class="app-header__inner">
		<label class="app-header__switch">
			<input
				type="checkbox"
				class="app-header__checkbox"
				checked={$hideCoversStore}
				onchange={(e) => handleHideCoversChange((e.currentTarget as HTMLInputElement).checked)}
				aria-checked={$hideCoversStore}
			/>
			<span class="app-header__switch-track" aria-hidden="true"></span>
			<span class="app-header__label">Hide cover images</span>
		</label>
	</div>
</header>
<main id="main" class:rate-page={$page.url.pathname === '/rate'}>
	{@render children()}
</main>

<style>
	.app-header {
		background: var(--color-card-bg);
		border-bottom: 1px solid var(--color-border);
	}
	.app-header__inner {
		max-width: 52rem;
		margin: 0 auto;
		padding: 0.75rem 1rem;
		display: flex;
		align-items: center;
	}
	.app-header__switch {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-size: 0.875rem;
		color: var(--color-text);
		user-select: none;
	}
	.app-header__checkbox {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	.app-header__switch-track {
		position: relative;
		width: 2.5rem;
		height: 1.375rem;
		background: var(--color-bg-muted);
		border-radius: 999px;
		transition: background 0.2s ease;
	}
	.app-header__switch-track::after {
		content: '';
		position: absolute;
		inset: 2px 0 2px 0;
		width: 1.125rem;
		border-radius: 50%;
		background: var(--color-card-bg);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
		left: 2px;
		transition: transform 0.2s ease;
	}
	.app-header__checkbox:checked + .app-header__switch-track {
		background: var(--color-accent-bg);
	}
	.app-header__checkbox:checked + .app-header__switch-track::after {
		transform: translateX(1.125rem);
	}
	.app-header__checkbox:focus-visible + .app-header__switch-track {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.app-header__label {
		flex: 1;
	}
</style>
