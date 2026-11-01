<script lang="ts">
	import BookAnnotations from '$lib/components/books/BookAnnotations.svelte';
	import type { Book } from '$lib/types/book';

	interface Props {
		book: Book;
	}

	let { book }: Props = $props();
</script>

<BookAnnotations {book} />
