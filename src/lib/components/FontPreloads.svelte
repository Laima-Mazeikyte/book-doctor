<script lang="ts">
	import { page } from '$app/state';

	const variable = '/fonts/bespoke-serif/fonts/BespokeSerif-Variable.woff2';
	const bold = '/fonts/bespoke-serif/fonts/BespokeSerif-Bold.woff2';
	const regular = '/fonts/bespoke-serif/fonts/BespokeSerif-Regular.woff2';
	const display = '/fonts/beth-ellen/fonts/BethEllen-Regular.woff2';
	const medium = '/fonts/inter/fonts/Inter-Medium.woff2';
	const semibold = '/fonts/inter/fonts/Inter-SemiBold.woff2';

	// Light body text and Inter Regular are shared in app.html. These additional
	// hints follow the initial route's typography, including SSR and client navigation.
	// Font definitions and CSS discovery still cover later/conditional content.
	const routeFonts: Record<string, readonly string[]> = {
		'/': [variable],
		'/rate': [variable, bold],
		'/faq': [variable],
		'/my-bookshelf': [variable, bold],
		'/not-interested': [display, regular, bold],
		'/rate/recommendations': [variable, bold],
		'/rate/recommendations/shortlist': [variable, bold],
		'/rate/recommendations/filtered': [variable, bold, semibold],
		'/books/[book_id]/[[slug]]': [bold, variable, medium],
		'/auth/reset-password': [bold, regular],
		'/lab': [variable, bold],
		'/lab/book-search': [variable, semibold],
		'/lab/recommendation-benchmark': [variable, semibold],
		'/lab/author-connections': [variable],
		'/lab/author-prominence': [variable, semibold]
	};
	const fonts = $derived(routeFonts[page.route.id ?? ''] ?? [variable]);
</script>

<svelte:head>
	{#each fonts as href (href)}
		<link rel="preload" {href} as="font" type="font/woff2" crossorigin="anonymous" />
	{/each}
</svelte:head>
