<script lang="ts">
	import { coverUrlForBookIdAtSize } from '$lib/book-cover';
	import { SvelteSet } from 'svelte/reactivity';
	import type { AuthorBook } from '$lib/lab/author-prominence/types';

	interface Props {
		books: AuthorBook[];
		onOpenBook: (book: AuthorBook, trigger: HTMLButtonElement) => void;
	}

	let { books, onOpenBook }: Props = $props();
	const failedCovers = new SvelteSet<string>();

	function markCoverFailed(bookId: string): void {
		failedCovers.add(bookId);
	}
</script>

<section
	class="prominence-covers"
	aria-label="Representative book covers"
	data-testid="prominence-covers"
>
	{#each books as book (book.bookUlid)}
		<figure class="prominence-cover">
			<button
				type="button"
				class="prominence-cover__button"
				data-book-ulid={book.bookUlid}
				aria-label={`Open ${book.title}`}
				onclick={(event) => onOpenBook(book, event.currentTarget)}
			>
				{#if !failedCovers.has(book.bookUlid) && coverUrlForBookIdAtSize(book.bookUlid, 200)}
					<img
						src={coverUrlForBookIdAtSize(book.bookUlid, 200)}
						alt=""
						width="200"
						height="300"
						loading="eager"
						decoding="async"
						onerror={() => markCoverFailed(book.bookUlid)}
					/>
				{:else}
					<div class="prominence-cover__fallback" aria-hidden="true">
						<span>{book.title}</span>
					</div>
				{/if}
			</button>
		</figure>
	{/each}
</section>

<style>
	.prominence-covers {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 7px;
		min-width: 0;
	}
	.prominence-cover {
		min-width: 0;
		margin: 0;
	}
	.prominence-cover__button {
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.prominence-cover__button:focus-visible {
		outline: 2px solid #e0a52f;
		outline-offset: 2px;
	}
	.prominence-cover img,
	.prominence-cover__fallback {
		display: block;
		width: 100%;
		aspect-ratio: 2 / 3;
		height: auto;
		box-sizing: border-box;
		border-radius: 4px;
	}
	.prominence-cover img {
		object-fit: cover;
		background: rgba(207, 231, 232, 0.08);
	}
	.prominence-cover__fallback {
		display: flex;
		align-items: flex-end;
		padding: 8px 6px;
		border: 1px solid rgba(224, 165, 47, 0.35);
		background: linear-gradient(140deg, rgba(224, 165, 47, 0.2), transparent 54%), #182727;
		color: #efffff;
		font: 600 10px/1.25 var(--font-family-interactive);
		overflow: hidden;
	}
	.prominence-cover__fallback span {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 5;
		line-clamp: 5;
		overflow: hidden;
	}
</style>
