<script lang="ts">
	import type { Book } from '$lib/types/book';
	import { coverUrlForBookIdAtSize } from '$lib/book-cover';
	let {
		book,
		large = false,
		eager = false,
		onRatio
	}: { book: Book; large?: boolean; eager?: boolean; onRatio?: (ratio: number) => void } = $props();
	let failed = $state(false);
</script>

<div class="selection-cover" class:large>
	{#if !failed && (book.coverUrl || coverUrlForBookIdAtSize(book.book_id, large ? 720 : 200))}
		<img
			src={coverUrlForBookIdAtSize(book.book_id, large ? 720 : 200) ?? book.coverUrl}
			alt=""
			width={large ? 168 : 68}
			height={large ? 252 : 102}
			loading={eager ? 'eager' : 'lazy'}
			decoding="async"
			onload={(event) => {
				const image = event.currentTarget as HTMLImageElement;
				if (large && image.naturalHeight) onRatio?.(image.naturalWidth / image.naturalHeight);
			}}
			onerror={() => {
				failed = true;
				if (large) onRatio?.(2 / 3);
			}}
		/>
	{:else}
		<div class="fallback"><strong>{book.title}</strong><span>{book.author}</span></div>
	{/if}
</div>

<style>
	.selection-cover {
		width: 68px;
		aspect-ratio: 2 / 3;
		flex: 0 0 auto;
		align-self: flex-start;
		border-radius: 4px;
		overflow: hidden;
		background: var(--color-bg-muted);
	}
	.selection-cover.large {
		height: var(--selection-cover-height, clamp(168px, 17.25vw, 252px));
		width: calc(
			var(--selection-cover-height, clamp(168px, 17.25vw, 252px)) *
				var(--selection-cover-ratio, 0.6666667)
		);
		aspect-ratio: auto;
		box-shadow: 0 6px 12px #0004;
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}
	.fallback {
		height: 100%;
		padding: 10px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		color: var(--color-book-title);
		border: 1px solid var(--color-border);
		font-size: 12px;
		overflow-wrap: anywhere;
	}
	.large .fallback {
		padding: 16px;
		font-size: 18px;
	}
	.fallback span {
		font-size: 0.75em;
		color: var(--color-text-muted);
	}
</style>
