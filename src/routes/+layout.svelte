<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import SkipLink from '$lib/components/SkipLink.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
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

<SkipLink />
<AppHeader hideCovers={$hideCoversStore} onHideCoversChange={handleHideCoversChange} />
<main id="main" class:rate-page={$page.url.pathname === '/rate'}>
	{@render children()}
</main>
