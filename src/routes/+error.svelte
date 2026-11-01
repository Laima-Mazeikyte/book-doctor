<script lang="ts">
	import { page } from '$app/state';
	import ErrorLanding from '$lib/components/ErrorLanding.svelte';
	import { notFoundQuote } from '$lib/copy/notFoundQuotes';

	const quote = $derived(notFoundQuote(page.data.errorQuoteSeed ?? 0, page.url.pathname));
</script>

<ErrorLanding status={page.status} {quote} />
