<script lang="ts">
	import { page } from '$app/stores';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<a href="#main" class="skip-link">Skip to main content</a>
<main id="main" class:rate-page={$page.url.pathname === '/rate'}>
	{@render children()}
</main>
