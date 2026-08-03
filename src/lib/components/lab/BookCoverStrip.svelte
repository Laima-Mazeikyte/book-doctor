<script lang="ts">
	import { coverUrlForBookIdAtSize } from '$lib/book-cover';

	interface Props {
		bookIds: string[];
	}

	let { bookIds }: Props = $props();
	let failedIds = $state<string[]>([]);

	function failed(bookId: string): boolean {
		return failedIds.includes(bookId);
	}

	function markFailed(bookId: string): void {
		if (!failed(bookId)) failedIds = [...failedIds, bookId];
	}
</script>

{#if bookIds.length > 0}
	<span class="book-cover-strip" aria-hidden="true">
		{#each bookIds as bookId (bookId)}
			<span class="book-cover-strip__item">
				{#if !failed(bookId) && coverUrlForBookIdAtSize(bookId, 200)}
					<img
						src={coverUrlForBookIdAtSize(bookId, 200)}
						alt=""
						width="40"
						height="60"
						loading="lazy"
						onerror={() => markFailed(bookId)}
					/>
				{:else}
					<span class="book-cover-strip__fallback"></span>
				{/if}
			</span>
		{/each}
	</span>
{/if}

<style>
	.book-cover-strip {
		display: flex;
		gap: 0.25rem;
		max-width: 100%;
		overflow-x: auto;
		padding-bottom: 0.125rem;
		scrollbar-width: thin;
	}
	.book-cover-strip__item,
	.book-cover-strip__fallback,
	.book-cover-strip img {
		display: block;
		flex: 0 0 auto;
		width: 2.5rem;
		height: 3.75rem;
		border-radius: var(--radius-xs);
	}
	.book-cover-strip__item {
		background: var(--color-card-placeholder-bg);
		border: 1px solid var(--color-border);
		overflow: hidden;
	}
	.book-cover-strip img {
		object-fit: cover;
	}
	.book-cover-strip__fallback {
		background:
			linear-gradient(
				135deg,
				transparent 48%,
				var(--color-border) 49%,
				var(--color-border) 51%,
				transparent 52%
			),
			var(--color-card-placeholder-bg);
	}
</style>
