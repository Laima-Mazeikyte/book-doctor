<script lang="ts">
	import '../../../app.css';
	import VirtualFeedGrid from '../VirtualFeedGrid.svelte';
	import BookCard from '$lib/components/BookCard.svelte';
	import { bookSummarySheetHistory } from '$lib/stores/bookSummarySheetHistory';
	import { ratingsStore } from '$lib/stores/ratings';
	import { planToReadStore } from '$lib/stores/planToRead';
	import type { Book } from '$lib/types/book';
	let { books, ownerId = 'virtual-reader' }: { books: Book[]; ownerId?: string } = $props();
</script>

<VirtualFeedGrid
	{books}
	{ownerId}
	pinnedBookUlid={$bookSummarySheetHistory?.bookUlid}
	onColumnsChange={() => {}}
	onLayout={() => {}}
>
	{#snippet children(book, coverPriority, coverUnavailable)}
		<BookCard
			{book}
			{coverPriority}
			{coverUnavailable}
			context="rate"
			bookmarked={$planToReadStore.has(book.id)}
			onRate={(_, value) => ratingsStore.setRating(book.id, value, book.book_id, book)}
			onRemoveRating={() => ratingsStore.removeRating(book.id, book.book_id)}
			onBookmark={() => planToReadStore.toggle(book.id, book.book_id, book)}
		/>
	{/snippet}
	{#snippet tail()}<button type="button">Load more books</button>{/snippet}
</VirtualFeedGrid>
