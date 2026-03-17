<script lang="ts">
	import { tick } from 'svelte';
	import { Eye, X, Bookmark, Check } from 'lucide-svelte';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';

	interface Props {
		book: Book;
		bookmarked?: boolean;
		onBookmark?: (bookId: string) => void;
		currentRating?: RatingValue | null;
		onRate?: (bookId: string, value: RatingValue) => void;
		onRemoveRating?: (bookId: string) => void;
	}

	let { book, bookmarked = false, onBookmark, currentRating = null, onRate, onRemoveRating }: Props = $props();

	let coverImageFailed = $state(false);
	let summaryOpen = $state(false);
	let summaryBtnRef: HTMLButtonElement | undefined = $state();
	let closeBtnRef: HTMLButtonElement | undefined = $state();
	let pendingRate = $state(false);
	let hoverRating = $state<number>(0);

	const RATING_OPTIONS: RatingValue[] = [1, 2, 3, 4, 5];
	const STAR_FILLED = '★';
	const STAR_EMPTY = '☆';

	/** Show only stars when rated; only "Saved to read list" when bookmarked; both buttons when neither (and not pending rate) */
	const showOnlyStars = $derived(currentRating != null);
	const showOnlyBookmark = $derived(bookmarked && currentRating == null);
	const showBothButtons = $derived(!showOnlyStars && !showOnlyBookmark);
	const showStarRow = $derived(showOnlyStars || pendingRate);
	/** Show action buttons only when not in "stars replaced buttons" (pending) state */
	const showActionButtons = $derived(showOnlyBookmark || (showBothButtons && !pendingRate));
	const displayRating = $derived(
		hoverRating > 0 ? hoverRating : (currentRating ?? 0)
	);

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

	function handleReadClick(e: MouseEvent) {
		e.stopPropagation();
		pendingRate = !pendingRate;
	}

	function handleStarClick(value: RatingValue) {
		if (currentRating === value) {
			onRemoveRating?.(book.id);
			pendingRate = false;
		} else {
			onRate?.(book.id, value);
			pendingRate = false;
		}
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
				aria-label={t('shared.recommendationCard.seeSummary')}
				aria-expanded={summaryOpen}
				onclick={handleOpenSummary}
			>
				<Eye size={20} aria-hidden="true" />
			</button>
		</div>
	</div>

	<div class="recommendation-card__body">
		{#if showActionButtons}
		<div class="recommendation-card__actions">
			{#if showOnlyBookmark}
				<button
					type="button"
					class="recommendation-card__action recommendation-card__action--saved"
					aria-pressed="true"
					aria-label={t('shared.recommendationCard.removeFromReadingList')}
					onclick={handleBookmarkClick}
				>
					<Bookmark size={14} aria-hidden="true" />
					<span>{t('shared.recommendationCard.savedToReadingList')}</span>
				</button>
			{:else if showBothButtons}
				<button
					type="button"
					class="recommendation-card__action recommendation-card__action--fill"
					aria-pressed="false"
					aria-label={t('shared.recommendationCard.addToReadingList')}
					onclick={handleBookmarkClick}
				>
					<Bookmark size={14} aria-hidden="true" />
					<span>{t('shared.recommendationCard.bookmark')}</span>
				</button>
				<button
					type="button"
					class="recommendation-card__action"
					aria-pressed="false"
					aria-label={t('shared.recommendationCard.markAsRead')}
					onclick={handleReadClick}
				>
					<Check size={14} aria-hidden="true" />
					<span>{t('shared.recommendationCard.read')}</span>
				</button>
			{/if}
		</div>
		{/if}
		{#if showStarRow}
			<div class="recommendation-card__rating-wrap">
				<div
					class="recommendation-card__rating"
					role="group"
					aria-label={t('shared.recommendationCard.rateThisBook')}
					onmouseleave={() => (hoverRating = 0)}
				>
					{#each RATING_OPTIONS as value}
						<button
							type="button"
							class="recommendation-card__star"
							class:recommendation-card__star--active={displayRating >= value}
							aria-label={currentRating === value ? t('shared.recommendationCard.rateOutOf5Clear', { value }) : t('shared.recommendationCard.rateOutOf5', { value })}
							aria-pressed={currentRating === value}
							onmouseenter={() => (hoverRating = value)}
							onclick={() => handleStarClick(value)}
						>
							<span aria-hidden="true">
								{displayRating >= value ? STAR_FILLED : STAR_EMPTY}
							</span>
						</button>
					{/each}
				</div>
				{#if pendingRate}
					<button
						type="button"
						class="recommendation-card__back"
						aria-label={t('shared.recommendationCard.backToWantToRead')}
						onclick={() => (pendingRate = false)}
					>
						{t('shared.recommendationCard.back')}
					</button>
				{/if}
			</div>
		{/if}
	</div>

	{#if summaryOpen}
		<div
			class="recommendation-card__summary-overlay"
			role="region"
			aria-label={t('shared.recommendationCard.bookSummary')}
			onkeydown={handleSummaryKeydown}
		>
			<button
				bind:this={closeBtnRef}
				type="button"
				class="recommendation-card__summary-close"
				aria-label={t('shared.recommendationCard.closeSummary')}
				onclick={handleCloseSummary}
			>
				<X size={18} aria-hidden="true" />
			</button>
			<div class="recommendation-card__summary-content">
				<ul class="recommendation-card__genres" aria-label={t('shared.recommendationCard.genres')}>
					{#each genres as genre}
						<li class="recommendation-card__genre">{genre}</li>
					{/each}
				</ul>
				<h3 class="recommendation-card__title">{book.title}</h3>
				<p class="recommendation-card__author">{book.author}{#if book.year}<span class="recommendation-card__year"> · {book.year}</span>{/if}</p>
				<p class="recommendation-card__summary">{displaySummary}</p>
				{#if showActionButtons}
				<div class="recommendation-card__actions">
					{#if showOnlyBookmark}
						<button
							type="button"
							class="recommendation-card__action recommendation-card__action--saved"
							aria-pressed="true"
							aria-label={t('shared.recommendationCard.removeFromReadingList')}
							onclick={handleBookmarkClick}
						>
							<Bookmark size={14} aria-hidden="true" />
							<span>{t('shared.recommendationCard.savedToReadingList')}</span>
						</button>
					{:else if showBothButtons}
						<button
							type="button"
							class="recommendation-card__action recommendation-card__action--fill"
							aria-pressed="false"
							aria-label={t('shared.recommendationCard.addToReadingList')}
							onclick={handleBookmarkClick}
						>
							<Bookmark size={14} aria-hidden="true" />
							<span>{t('shared.recommendationCard.bookmark')}</span>
						</button>
						<button
							type="button"
							class="recommendation-card__action"
							aria-pressed="false"
							aria-label={t('shared.recommendationCard.markAsRead')}
							onclick={handleReadClick}
						>
							<Check size={14} aria-hidden="true" />
							<span>{t('shared.recommendationCard.read')}</span>
						</button>
					{/if}
				</div>
				{/if}
				{#if showStarRow}
					<div class="recommendation-card__rating-wrap">
						<div
							class="recommendation-card__rating"
							role="group"
							aria-label={t('shared.recommendationCard.rateThisBook')}
							onmouseleave={() => (hoverRating = 0)}
						>
							{#each RATING_OPTIONS as value}
								<button
									type="button"
									class="recommendation-card__star"
									class:recommendation-card__star--active={displayRating >= value}
									aria-label={currentRating === value ? t('shared.recommendationCard.rateOutOf5Clear', { value }) : t('shared.recommendationCard.rateOutOf5', { value })}
									aria-pressed={currentRating === value}
									onmouseenter={() => (hoverRating = value)}
									onclick={() => handleStarClick(value)}
								>
									<span aria-hidden="true">
										{displayRating >= value ? STAR_FILLED : STAR_EMPTY}
									</span>
								</button>
							{/each}
						</div>
						{#if pendingRate}
							<button
								type="button"
								class="recommendation-card__back"
								aria-label={t('shared.recommendationCard.backToWantToRead')}
								onclick={() => (pendingRate = false)}
							>
								{t('shared.recommendationCard.back')}
							</button>
						{/if}
					</div>
				{/if}
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
		padding: 8px;
		justify-content: flex-start;
		align-items: stretch;
		gap: var(--space-2);
	}

	.recommendation-card__actions {
		display: flex;
		flex-wrap: nowrap;
		gap: var(--space-2);
		align-items: stretch;
		width: 100%;
		min-width: 0;
	}

	/* Shared action button – same height as stars (2.25rem) */
	.recommendation-card__action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		padding: 0 var(--space-3);
		min-height: 2.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		font-family: inherit;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
		white-space: nowrap;
		min-width: 0;
	}
	.recommendation-card__action:hover {
		background: var(--color-bg-hover);
	}
	.recommendation-card__action:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.recommendation-card__action--fill {
		flex: 1;
	}
	.recommendation-card__action :global(svg) {
		flex-shrink: 0;
	}
	.recommendation-card__action--saved {
		flex: 1;
		background: #d1fae5;
		color: #065f46;
		border-color: rgba(5, 150, 105, 0.4);
	}
	.recommendation-card__action--saved:hover {
		background: #a7f3d0;
	}
	@media (prefers-color-scheme: dark) {
		.recommendation-card__action--saved {
			background: rgba(16, 185, 129, 0.18);
			color: #6ee7b7;
			border-color: rgba(16, 185, 129, 0.35);
		}
		.recommendation-card__action--saved:hover {
			background: rgba(16, 185, 129, 0.28);
		}
	}

	.recommendation-card__rating-wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: center;
		width: 100%;
		min-width: 0;
	}
	.recommendation-card__back {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-family: inherit;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.recommendation-card__back:hover {
		color: var(--color-text);
	}
	.recommendation-card__back:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}

	/* Star rating row */
	.recommendation-card__rating {
		display: flex;
		gap: 0;
		justify-content: center;
		align-items: center;
		flex-wrap: nowrap;
		white-space: nowrap;
		min-width: min-content;
	}
	.recommendation-card__star {
		min-width: 2.25rem;
		min-height: 2.25rem;
		padding: var(--space-1);
		font-size: 1.375rem;
		line-height: 1;
		border: none;
		background: transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
		color: var(--color-text-muted);
	}
	.recommendation-card__star:hover {
		background: var(--color-bg-hover);
		color: var(--color-text);
	}
	.recommendation-card__star:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.recommendation-card__star--active {
		background: transparent;
		color: var(--color-text);
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
	.recommendation-card__summary-close {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		z-index: 11;
		width: var(--min-tap);
		height: var(--min-tap);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: rgba(245, 245, 245, 0.85);
		border-radius: var(--radius-pill);
		cursor: pointer;
		color: var(--color-text);
		transition: background var(--duration-fast) var(--ease-default);
	}
	.recommendation-card__summary-close:hover {
		background: rgba(235, 235, 235, 0.9);
	}
	@media (prefers-color-scheme: dark) {
		.recommendation-card__summary-close {
			background: rgba(23, 23, 23, 0.85);
			color: var(--color-text);
		}
		.recommendation-card__summary-close:hover {
			background: rgba(38, 38, 38, 0.9);
		}
	}
	.recommendation-card__summary-close:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.recommendation-card__summary-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px var(--space-3) var(--space-3);
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
	@media (prefers-color-scheme: dark) {
		.recommendation-card__genre {
			background: var(--primitive-gray-200);
			color: var(--color-text);
		}
	}
</style>
