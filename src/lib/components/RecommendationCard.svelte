<script lang="ts">
	import { tick } from 'svelte';
	import { Eye, X, Bookmark } from 'lucide-svelte';
	import type { Book } from '$lib/types/book';

	interface Props {
		book: Book;
		bookmarked?: boolean;
		onBookmark?: (bookId: string) => void;
	}

	let { book, bookmarked = false, onBookmark }: Props = $props();

	let coverImageFailed = $state(false);
	let summaryOpen = $state(false);
	let summaryBtnRef: HTMLButtonElement | undefined = $state();
	let closeBtnRef: HTMLButtonElement | undefined = $state();

	const showCoverImage = $derived(Boolean(book.coverUrl) && !coverImageFailed);

	const DUMMY_SUMMARY =
		'Concrete sidewalks crack under the weight of history as a young man navigates the geography of his own upbringing. These poems map the precise intersection where personal memory meets the systemic pressures of a changing neighborhood. Every stanza acts as a pulse check on the fragile stability of a life built amidst shifting urban landscapes.';

	const displaySummary = $derived(DUMMY_SUMMARY);

	const DEFAULT_GENRES = ['Fiction', 'Mystery', 'Romance'];
	const genres = $derived(
		book.genres && book.genres.length > 0 ? book.genres : DEFAULT_GENRES
	);

	async function handleOpenSummary() {
		summaryOpen = true;
		await tick();
		closeBtnRef?.focus();
	}

	async function handleCloseSummary() {
		summaryOpen = false;
		await tick();
		summaryBtnRef?.focus();
	}

	function handleSummaryKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') handleCloseSummary();
	}

	function handleBookmarkClick(e: MouseEvent) {
		e.stopPropagation();
		onBookmark?.(book.id);
	}
</script>

<article
	class="recommendation-card"
	data-book-id={book.id}
	aria-label="{book.title} by {book.author}"
>
	<div class="recommendation-card__media">
		<div class="recommendation-card__media-inner">
			{#if showCoverImage}
				<img
					src={book.coverUrl}
					alt=""
					class="recommendation-card__cover"
					onerror={() => (coverImageFailed = true)}
				/>
			{:else}
				<div class="recommendation-card__cover recommendation-card__cover--no-image">
					<span class="recommendation-card__placeholder-author">{book.author}{#if book.year}<span class="recommendation-card__placeholder-year"> · {book.year}</span>{/if}</span>
					<span class="recommendation-card__placeholder-title">{book.title}</span>
				</div>
			{/if}
			<button
				bind:this={summaryBtnRef}
				type="button"
				class="recommendation-card__summary-btn"
				aria-label="See summary"
				aria-expanded={summaryOpen}
				onclick={handleOpenSummary}
			>
				<Eye size={20} aria-hidden="true" />
			</button>
		</div>
	</div>

	<div class="recommendation-card__body">
		<button
			type="button"
			class="recommendation-card__want-to-read"
			class:recommendation-card__want-to-read--active={bookmarked}
			aria-pressed={bookmarked}
			aria-label={bookmarked ? 'Remove from reading list' : 'Add to reading list'}
			onclick={handleBookmarkClick}
		>
			{#if bookmarked}
				<Bookmark size={14} aria-hidden="true" />
			{/if}
			<span>{bookmarked ? 'Added to read list' : 'Want to read'}</span>
		</button>
	</div>

	{#if summaryOpen}
		<div
			class="recommendation-card__summary-overlay"
			role="region"
			aria-label="Book summary"
			onkeydown={handleSummaryKeydown}
		>
			<div class="recommendation-card__summary-header">
				<button
					bind:this={closeBtnRef}
					type="button"
					class="recommendation-card__summary-close"
					aria-label="Close summary"
					onclick={handleCloseSummary}
				>
					<X size={18} aria-hidden="true" />
				</button>
			</div>
			<div class="recommendation-card__summary-content">
				<h3 class="recommendation-card__title">{book.title}</h3>
				<p class="recommendation-card__author">{book.author}{#if book.year}<span class="recommendation-card__year"> · {book.year}</span>{/if}</p>
				<p class="recommendation-card__summary">{displaySummary}</p>
				<ul class="recommendation-card__genres" aria-label="Genres">
					{#each genres as genre}
						<li class="recommendation-card__genre">{genre}</li>
					{/each}
				</ul>
			</div>
		</div>
	{/if}
</article>

<style>
	.recommendation-card {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 0;
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		box-shadow: var(--shadow-card);
		transition: box-shadow var(--duration-normal) var(--ease-default),
			border-color var(--duration-normal) var(--ease-default);
	}
	.recommendation-card:hover {
		box-shadow: var(--shadow-card-hover);
		border-color: var(--color-border-hover);
	}

	.recommendation-card__media {
		flex: 0 0 auto;
		aspect-ratio: 2 / 3;
		width: 100%;
		min-height: 0;
		background: var(--color-card-bg);
		padding: 0 var(--space-2);
		padding-top: var(--space-2);
	}
	.recommendation-card__media-inner {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		border-radius: var(--radius-sm);
	}
	.recommendation-card__cover {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center center;
		border-radius: var(--radius-sm);
		transition: transform var(--duration-normal) var(--ease-default);
	}
	.recommendation-card:hover .recommendation-card__cover:not(.recommendation-card__cover--no-image) {
		transform: scale(1.05);
	}
	.recommendation-card__cover--no-image {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-card-placeholder-bg);
		border-radius: var(--radius-sm);
		text-align: left;
		transition: transform var(--duration-normal) var(--ease-default);
		transform-origin: center center;
	}
	.recommendation-card:hover .recommendation-card__cover--no-image {
		transform: scale(1.03);
	}
	.recommendation-card__placeholder-author {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.recommendation-card__placeholder-title {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		line-height: 1.35;
		letter-spacing: -0.01em;
		color: var(--color-text);
	}
	.recommendation-card__placeholder-year {
		opacity: 0.75;
	}

	.recommendation-card__summary-btn {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		z-index: 2;
		width: var(--min-tap);
		height: var(--min-tap);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: var(--color-card-bg);
		border-radius: var(--radius-pill);
		cursor: pointer;
		color: var(--color-text);
		transition: background var(--duration-fast) var(--ease-default);
	}
	.recommendation-card__summary-btn:hover {
		background: var(--color-bg-hover);
	}
	.recommendation-card__summary-btn:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}

	.recommendation-card__body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		height: fit-content;
		padding: 6px 8px;
		justify-content: center;
		align-items: flex-start;
	}

	/* Want to read button */
	.recommendation-card__want-to-read {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		min-height: var(--min-tap);
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		font-family: inherit;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
		white-space: nowrap;
	}
	.recommendation-card__want-to-read:hover {
		background: var(--color-bg-hover);
	}
	.recommendation-card__want-to-read:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.recommendation-card__want-to-read--active {
		background: #d1fae5;
		color: #065f46;
	}
	.recommendation-card__want-to-read--active:hover {
		background: #a7f3d0;
	}
	@media (prefers-color-scheme: dark) {
		.recommendation-card__want-to-read--active {
			background: rgba(16, 185, 129, 0.18);
			color: #6ee7b7;
		}
		.recommendation-card__want-to-read--active:hover {
			background: rgba(16, 185, 129, 0.28);
		}
	}

	/* Summary overlay */
	.recommendation-card__summary-overlay {
		position: absolute;
		inset: 0;
		z-index: 10;
		background: var(--color-card-bg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: var(--radius);
	}
	.recommendation-card__summary-header {
		display: flex;
		justify-content: flex-end;
		padding: var(--space-2);
		flex-shrink: 0;
	}
	.recommendation-card__summary-close {
		width: var(--min-tap);
		height: var(--min-tap);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: var(--color-bg-muted);
		border-radius: var(--radius-pill);
		cursor: pointer;
		color: var(--color-text);
		transition: background var(--duration-fast) var(--ease-default);
	}
	.recommendation-card__summary-close:hover {
		background: var(--color-bg-hover);
	}
	.recommendation-card__summary-close:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.recommendation-card__summary-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 var(--space-3) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		/* Custom thin scrollbar – Firefox */
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
	}
	/* Custom thin scrollbar – Chromium */
	.recommendation-card__summary-content::-webkit-scrollbar {
		width: 3px;
	}
	.recommendation-card__summary-content::-webkit-scrollbar-track {
		background: transparent;
	}
	.recommendation-card__summary-content::-webkit-scrollbar-thumb {
		background: var(--color-border);
		border-radius: var(--radius-pill);
	}
	.recommendation-card__summary-content::-webkit-scrollbar-thumb:hover {
		background: var(--color-border-hover);
	}
	.recommendation-card__title {
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		line-height: var(--line-height-tight);
		margin: 0;
		color: var(--color-text);
	}
	.recommendation-card__author {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin: 0;
	}
	.recommendation-card__year {
		opacity: 0.75;
	}
	.recommendation-card__summary {
		font-size: var(--font-size-sm);
		line-height: var(--line-height-relaxed);
		color: var(--color-text);
		margin: 0;
	}
	.recommendation-card__genres {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.recommendation-card__genre {
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-xs);
		background: var(--color-bg-muted);
		border-radius: var(--radius-pill);
		color: var(--color-text);
	}
</style>
