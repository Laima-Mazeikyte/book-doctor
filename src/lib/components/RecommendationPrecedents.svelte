<script lang="ts">
	import { coverUrlForBookIdAtSize } from '$lib/book-cover';
	import BookSummarySheet from '$lib/components/book-card/BookSummarySheet.svelte';
	import { t } from '$lib/copy';
	import { SvelteSet } from 'svelte/reactivity';
	import type { Book } from '$lib/types/book';
	import type { BookSummarySheetState } from '$lib/components/book-card/bookSummarySheet';

	type Props = {
		books?: Book[];
	};

	let { books = [] }: Props = $props();
	let summaryState = $state<BookSummarySheetState>({ kind: 'closed' });
	const displayedBooks = $derived(books.slice(0, 3));
	const failedCovers = new SvelteSet<string>();

	function openSummary(event: MouseEvent, book: Book): void {
		const trigger = event.currentTarget;
		if (!(trigger instanceof HTMLButtonElement)) return;
		summaryState = { kind: 'ready', book, trigger };
	}

	function closeSummary(): void {
		summaryState = { kind: 'closed' };
	}

	function markCoverFailed(bookId: string): void {
		failedCovers.add(bookId);
	}

	function summaryAriaLabel(book: Book): string {
		return book.author?.trim()
			? t('shared.recommendationCard.seeSummaryCoverAriaLabelWithAuthor', {
					title: book.title,
					author: book.author.trim()
				})
			: t('shared.recommendationCard.seeSummaryCoverAriaLabelTitleOnly', { title: book.title });
	}
</script>

{#if displayedBooks.length > 0}
	<div class="recommendation-precedents">
		<span class="recommendation-precedents__label typ-caption">
			{t('recommendations.becauseYouLiked')}:
		</span>
		<div class="recommendation-precedents__covers">
			{#each displayedBooks as book (book.book_id)}
				<button
					type="button"
					class="recommendation-precedents__cover-button"
					aria-label={summaryAriaLabel(book)}
					onclick={(event) => openSummary(event, book)}
				>
					{#if !failedCovers.has(book.book_id) && coverUrlForBookIdAtSize(book.book_id, 200)}
						<img
							src={coverUrlForBookIdAtSize(book.book_id, 200)}
							alt=""
							width="200"
							height="300"
							class="recommendation-precedents__cover"
							loading="lazy"
							decoding="async"
							onerror={() => markCoverFailed(book.book_id)}
						/>
					{:else}
						<span class="recommendation-precedents__cover-fallback" aria-hidden="true"></span>
					{/if}
				</button>
			{/each}
		</div>
	</div>
{/if}

<BookSummarySheet state={summaryState} showRatingStars={false} onClose={closeSummary} />

<style>
	.recommendation-precedents {
		width: 100%;
		margin: 0;
		color: var(--color-text-muted);
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
	}
	.recommendation-precedents__label {
		font-weight: var(--typ-interactive-2-font-weight);
	}
	.recommendation-precedents__covers {
		display: flex;
		justify-content: center;
		gap: var(--space-2);
	}
	.recommendation-precedents__cover-button {
		width: 3rem;
		aspect-ratio: 2 / 3;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-card-placeholder-bg);
		cursor: pointer;
		overflow: hidden;
		transition:
			transform var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default);
	}
	.recommendation-precedents__cover-button:hover {
		transform: translateY(-2px);
		border-color: var(--color-border-hover);
		box-shadow: var(--shadow-card-hover);
	}
	.recommendation-precedents__cover-button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.recommendation-precedents__cover {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.recommendation-precedents__cover-fallback {
		display: block;
		width: 100%;
		height: 100%;
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
