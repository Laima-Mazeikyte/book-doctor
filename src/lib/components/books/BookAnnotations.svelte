<script lang="ts">
	import type { Book } from '$lib/types/book';
	import { distinctionLabel, distinctionDescription } from '$lib/books/distinctions';
	let { book }: { book: Book } = $props();
	const distinctions = $derived(
		[book.distinctions?.book, book.distinctions?.author].filter((item) => item != null)
	);
</script>

{#if book.characteristics?.length || distinctions.length || book.keywords?.length}
	<ul
		class="book-annotations"
		aria-label="Book characteristics and distinctions"
		data-testid="book-annotations"
	>
		{#each book.characteristics ?? [] as characteristic (characteristic.label)}
			<li title={characteristic.description}>{characteristic.label}</li>
		{/each}
		{#each distinctions as distinction (distinction.subject)}
			<li title={distinctionDescription(distinction)}>{distinctionLabel(distinction)}</li>
		{/each}
		{#each book.keywords ?? [] as keyword (keyword)}<li>{keyword}</li>{/each}
	</ul>
{/if}

<style>
	.book-annotations {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.8rem;
		list-style: none;
		padding: 0;
		margin: 0.75rem 0;
		color: var(--color-text);
		font-weight: 500;
	}
	.book-annotations li {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.book-annotations li:not(:last-child) {
		border-right: 1px solid var(--color-border);
		padding-right: 0.8rem;
	}
</style>
