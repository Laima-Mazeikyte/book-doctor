<script lang="ts">
	import BookDetailPage from '$lib/components/books/BookDetailPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

{#key data.book.book_id}
	<BookDetailPage {...data} />
{/key}
