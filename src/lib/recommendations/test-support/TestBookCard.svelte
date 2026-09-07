<script lang="ts">
	import type { Book } from '$lib/types/book';

	let { book }: { book: Book } = $props();
</script>

<div data-testid="test-book-card">{book.title}</div>
