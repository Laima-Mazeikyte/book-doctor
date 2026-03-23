  <script lang="ts">
	import { tick } from 'svelte';
	import { Eye, X, Bookmark, Star, Ban, Search } from 'lucide-svelte';
	import { ratingsStore } from '$lib/stores/ratings';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';
	import type { BookCardListProps } from './book-card/types';
	import { getBookDisplaySummary } from './book-card/summaryStub';

	let {
		book,
		context,
		onSearchAuthor,
		bookmarked = false,
		onBookmark,
		currentRating: currentRatingProp = null,
		onRate,
		onRemoveRating,
		notInterested = false,
		onNotInterested,
		onAfterRate
	}: BookCardListProps = $props();

	const isRateContext = $derived(context === 'rate');

	let coverImageFailed = $state(false);
	let summaryOpen = $state(false);
	let summaryBtnRef: HTMLButtonElement | undefined = $state();
	let closeBtnRef: HTMLButtonElement | undefined = $state();
	let pendingRate = $state(false);
	let hoverRating = $state<number>(0);

	const RATING_OPTIONS: RatingValue[] = [1, 2, 3, 4, 5];
	const STAR_FILLED = '★';
	const STAR_EMPTY = '☆';

	const ratingFromStore = $derived($ratingsStore.get(book.id));
	const currentRating = $derived(
		isRateContext ? ratingFromStore ?? null : (currentRatingProp ?? null)
	);

	const showOnlyStars = $derived(!isRateContext && currentRating != null);
	const showThreeButtons = $derived(!isRateContext && !showOnlyStars && !pendingRate);
	const showStarRow = $derived(isRateContext || showOnlyStars || pendingRate);
	const showActionButtons = $derived(!isRateContext && !showOnlyStars && showThreeButtons);

	const displayRating = $derived(
		hoverRating > 0
			? hoverRating
			: isRateContext
				? (ratingFromStore ?? 0)
				: (currentRating ?? 0)
	);

	const showCoverImage = $derived(Boolean(book.coverUrl) && !coverImageFailed);
	const displaySummary = $derived(getBookDisplaySummary(book));
	const showSearchAuthorInOverlay = $derived(
		Boolean(onSearchAuthor && book.author?.trim())
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

	function handleNotInterestedClick(e: MouseEvent) {
		e.stopPropagation();
		onNotInterested?.(book.id);
	}

	function handleReadClick(e: MouseEvent) {
		e.stopPropagation();
		pendingRate = !pendingRate;
	}

	function handleStarClick(value: RatingValue) {
		if (isRateContext) {
			hoverRating = 0;
			if (ratingFromStore === value) {
				ratingsStore.removeRating(book.id, book.book_id);
			} else {
				ratingsStore.setRating(book.id, value, book.book_id, book);
			}
			onAfterRate?.(book);
			return;
		}
		if (currentRating === value) {
			onRemoveRating?.(book.id);
			pendingRate = false;
		} else {
			onRate?.(book.id, value);
			pendingRate = false;
		}
	}

	function starAriaLabel(value: RatingValue): string {
		if (isRateContext) {
			return ratingFromStore === value
				? t('shared.bookCard.rateOutOf5Clear', { value })
				: t('shared.bookCard.rateOutOf5', { value });
		}
		return currentRating === value
			? t('shared.recommendationCard.rateOutOf5Clear', { value })
			: t('shared.recommendationCard.rateOutOf5', { value });
	}

	function starAriaPressed(value: RatingValue): boolean {
		if (isRateContext) {
			return ratingFromStore === value;
		}
		return currentRating === value;
	}
</script>

<article
	class="book-card"
	data-book-id={book.id}
	data-context={context}
	aria-label="{book.title} by {book.author}"
>
	<div class="book-card__media">
		<div class="book-card__media-inner">
			{#if showCoverImage}
				<img
					src={book.coverUrl}
					alt=""
					class="book-card__cover"
					onerror={() => (coverImageFailed = true)}
				/>
			{:else}
				<div class="book-card__cover book-card__cover--no-image">
					<span class="book-card__placeholder-author">{book.author}{#if book.year}<span class="book-card__year"> · {book.year}</span>{/if}</span>
					<span class="book-card__placeholder-title">{book.title}</span>
				</div>
			{/if}
			<button
				bind:this={summaryBtnRef}
				type="button"
				class="book-card__summary-btn"
				aria-label={t('shared.recommendationCard.seeSummary')}
				aria-expanded={summaryOpen}
				onclick={handleOpenSummary}
			>
				<Eye size={20} aria-hidden="true" />
			</button>
		</div>
	</div>

	<div class="book-card__body">
		{#if showActionButtons}
			<div class="book-card__actions">
				<button
					type="button"
					class="book-card__action book-card__action--fill"
					class:book-card__action--saved={bookmarked}
					class:book-card__action--icon={notInterested}
					aria-pressed={bookmarked}
					aria-label={bookmarked ? t('shared.recommendationCard.removeFromReadingList') : t('shared.recommendationCard.addToReadingList')}
					onclick={handleBookmarkClick}
				>
					<Bookmark size={14} aria-hidden="true" />
					{#if !notInterested}
						<span>{bookmarked ? t('shared.recommendationCard.saved') : t('shared.recommendationCard.bookmark')}</span>
					{/if}
				</button>
				<button
					type="button"
					class="book-card__action book-card__action--fill"
					class:book-card__action--icon={notInterested}
					aria-pressed="false"
					aria-label={t('shared.recommendationCard.markAsRead')}
					onclick={handleReadClick}
				>
					<Star size={14} aria-hidden="true" />
					{#if !notInterested}
						<span>{t('shared.recommendationCard.read')}</span>
					{/if}
				</button>
				{#if onNotInterested}
					<button
						type="button"
						class="book-card__action"
						class:book-card__action--icon={!notInterested}
						class:book-card__action--fill={notInterested}
						class:book-card__action--not-interested-active={notInterested}
						aria-pressed={notInterested}
						aria-label={notInterested ? t('shared.recommendationCard.removeFromNotInterested') : t('shared.recommendationCard.notInterested')}
						onclick={handleNotInterestedClick}
					>
						<Ban size={14} aria-hidden="true" />
						{#if notInterested}
							<span>{t('shared.recommendationCard.notInterested')}</span>
						{/if}
					</button>
				{/if}
			</div>
		{/if}
		{#if showStarRow}
			<div class="book-card__rating-wrap">
				<div
					class="book-card__rating"
					role="group"
					aria-label={isRateContext ? t('shared.bookCard.rateThisBook') : t('shared.recommendationCard.rateThisBook')}
					onmouseleave={() => (hoverRating = 0)}
				>
					{#each RATING_OPTIONS as value}
						<button
							type="button"
							class="book-card__star"
							class:book-card__star--active={displayRating >= value}
							aria-label={starAriaLabel(value)}
							aria-pressed={starAriaPressed(value)}
							onmouseenter={() => (hoverRating = value)}
							onclick={() => {
								if (isRateContext) hoverRating = 0;
								handleStarClick(value);
							}}
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
						class="book-card__back"
						aria-label={t('shared.recommendationCard.backToWantToRead')}
						onclick={() => (pendingRate = false)}
					>
						{t('shared.recommendationCard.back')}
					</button>
				{/if}
				{#if isRateContext && onNotInterested}
					<button
						type="button"
						class="book-card__action book-card__action--rate-not-interested"
						class:book-card__action--icon={!notInterested}
						class:book-card__action--fill={notInterested}
						class:book-card__action--not-interested-active={notInterested}
						aria-pressed={notInterested}
						aria-label={notInterested ? t('shared.recommendationCard.removeFromNotInterested') : t('shared.recommendationCard.notInterested')}
						onclick={handleNotInterestedClick}
					>
						<Ban size={14} aria-hidden="true" />
						<span>{t('shared.recommendationCard.notInterested')}</span>
					</button>
				{/if}
			</div>
		{/if}
	</div>

	{#if summaryOpen}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="book-card__summary-overlay"
			role="region"
			aria-label={t('shared.recommendationCard.bookSummary')}
			onkeydown={handleSummaryKeydown}
		>
			<button
				bind:this={closeBtnRef}
				type="button"
				class="book-card__summary-close"
				aria-label={t('shared.recommendationCard.closeSummary')}
				onclick={handleCloseSummary}
			>
				<X size={18} aria-hidden="true" />
			</button>
			<div class="book-card__summary-content">
				{#if book.genres && book.genres.length > 0}
					<ul class="book-card__genres" aria-label={t('shared.recommendationCard.genres')}>
						{#each book.genres as genre}
							<li class="book-card__genre">{genre}</li>
						{/each}
					</ul>
				{/if}
				<h3 class="book-card__title">{book.title}</h3>
				<p class="book-card__author">{book.author}{#if book.year}<span class="book-card__year"> · {book.year}</span>{/if}</p>
				<p class="book-card__summary">{displaySummary}</p>

				{#if showSearchAuthorInOverlay}
					<div class="book-card__summary-search">
						<button
							type="button"
							class="book-card__summary-search-btn"
							aria-label={t('shared.bookCard.searchThisAuthorAriaLabel', { author: book.author })}
							onclick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								onSearchAuthor?.(book.author);
								handleCloseSummary();
							}}
						>
							<Search size={14} aria-hidden="true" />
							<span>{t('shared.bookCard.searchThisAuthor')}</span>
						</button>
					</div>
				{/if}

				{#if showActionButtons}
					<div class="book-card__actions">
						<button
							type="button"
							class="book-card__action book-card__action--fill"
							class:book-card__action--saved={bookmarked}
							class:book-card__action--icon={notInterested}
							aria-pressed={bookmarked}
							aria-label={bookmarked ? t('shared.recommendationCard.removeFromReadingList') : t('shared.recommendationCard.addToReadingList')}
							onclick={handleBookmarkClick}
						>
							<Bookmark size={14} aria-hidden="true" />
							{#if !notInterested}
								<span>{bookmarked ? t('shared.recommendationCard.saved') : t('shared.recommendationCard.bookmark')}</span>
							{/if}
						</button>
						<button
							type="button"
							class="book-card__action book-card__action--fill"
							class:book-card__action--icon={notInterested}
							aria-pressed="false"
							aria-label={t('shared.recommendationCard.markAsRead')}
							onclick={handleReadClick}
						>
							<Star size={14} aria-hidden="true" />
							{#if !notInterested}
								<span>{t('shared.recommendationCard.read')}</span>
							{/if}
						</button>
						{#if onNotInterested}
							<button
								type="button"
								class="book-card__action"
								class:book-card__action--icon={!notInterested}
								class:book-card__action--fill={notInterested}
								class:book-card__action--not-interested-active={notInterested}
								aria-pressed={notInterested}
								aria-label={notInterested ? t('shared.recommendationCard.removeFromNotInterested') : t('shared.recommendationCard.notInterested')}
								onclick={handleNotInterestedClick}
							>
								<Ban size={14} aria-hidden="true" />
								{#if notInterested}
									<span>{t('shared.recommendationCard.notInterested')}</span>
								{/if}
							</button>
						{/if}
					</div>
				{/if}
				{#if showStarRow}
					<div class="book-card__rating-wrap">
						<div
							class="book-card__rating"
							role="group"
							aria-label={isRateContext ? t('shared.bookCard.rateThisBook') : t('shared.recommendationCard.rateThisBook')}
							onmouseleave={() => (hoverRating = 0)}
						>
							{#each RATING_OPTIONS as value}
								<button
									type="button"
									class="book-card__star"
									class:book-card__star--active={displayRating >= value}
									aria-label={starAriaLabel(value)}
									aria-pressed={starAriaPressed(value)}
									onmouseenter={() => (hoverRating = value)}
									onclick={() => {
										if (isRateContext) hoverRating = 0;
										handleStarClick(value);
									}}
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
								class="book-card__back"
								aria-label={t('shared.recommendationCard.backToWantToRead')}
								onclick={() => (pendingRate = false)}
							>
								{t('shared.recommendationCard.back')}
							</button>
						{/if}
						{#if isRateContext && onNotInterested}
							<button
								type="button"
								class="book-card__action book-card__action--rate-not-interested"
								class:book-card__action--icon={!notInterested}
								class:book-card__action--fill={notInterested}
								class:book-card__action--not-interested-active={notInterested}
								aria-pressed={notInterested}
								aria-label={notInterested ? t('shared.recommendationCard.removeFromNotInterested') : t('shared.recommendationCard.notInterested')}
								onclick={handleNotInterestedClick}
							>
								<Ban size={14} aria-hidden="true" />
								<span>{t('shared.recommendationCard.notInterested')}</span>
							</button>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</article>

<style>
	/* Shell + media: tokens in app.css (--book-card-*) */
	.book-card {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		text-align: left;
		padding: 0;
		border-radius: var(--book-card-radius, var(--radius));
		overflow: hidden;
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		box-shadow: var(--shadow-card);
		transition: box-shadow var(--duration-normal) var(--ease-default),
			border-color var(--duration-normal) var(--ease-default);
	}
	.book-card:hover {
		box-shadow: var(--shadow-card-hover);
		border-color: var(--color-border-hover);
	}

	.book-card__media {
		flex: 0 0 auto;
		aspect-ratio: 2 / 3;
		width: 100%;
		min-height: 0;
		background: var(--color-card-bg);
		padding: 0 var(--space-1);
		padding-top: var(--space-1);
	}
	.book-card__media-inner {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		border-radius: var(--radius-sm);
	}
	.book-card__cover {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center center;
		border-radius: var(--radius-sm);
		transition: transform var(--duration-normal) var(--ease-default);
	}
	.book-card:hover .book-card__cover:not(.book-card__cover--no-image) {
		transform: scale(1.05);
	}
	.book-card__cover--no-image {
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
	.book-card:hover .book-card__cover--no-image {
		transform: scale(1.03);
	}
	.book-card__placeholder-author {
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-text-muted);
	}
	.book-card__placeholder-title {
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--font-weight-semibold);
		line-height: var(--line-height-tight);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-text);
	}
	.book-card__year {
		opacity: 0.75;
	}

	.book-card__summary-btn {
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
		background: var(--color-bg-muted);
		border-radius: var(--radius-pill);
		cursor: pointer;
		color: var(--color-text);
		transition: background var(--duration-fast) var(--ease-default);
	}
	.book-card__summary-btn:hover {
		background: var(--color-bg-hover);
	}
	.book-card__summary-btn:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}

	.book-card__body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		height: fit-content;
		padding: var(--book-card-body-padding, 8px);
		justify-content: flex-start;
		align-items: stretch;
		gap: var(--space-2);
	}

	.book-card__actions {
		display: flex;
		flex-wrap: nowrap;
		gap: var(--space-2);
		align-items: stretch;
		width: 100%;
		min-width: 0;
	}

	.book-card__action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		padding: 0 var(--space-3);
		min-height: var(--book-card-action-height, 2.25rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
		white-space: nowrap;
		min-width: 0;
	}
	.book-card__action:hover {
		background: var(--color-bg-hover);
	}
	.book-card__action:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.book-card__action--fill {
		flex: 1;
	}
	.book-card__action--icon {
		flex: 0 0 auto;
		min-width: 0;
		width: var(--book-card-action-height, 2.25rem);
		padding: 0 var(--space-1);
	}
	.book-card__action--icon :global(svg) {
		flex-shrink: 0;
	}
	.book-card__action :global(svg) {
		flex-shrink: 0;
	}
	.book-card__action--saved {
		background: var(--color-success-bg);
		color: var(--color-success-text);
		border-color: var(--color-success-border);
	}
	.book-card__action--saved:hover {
		background: var(--color-success-bg-hover);
	}
	.book-card__action.book-card__action--not-interested-active {
		background: var(--color-danger-tonal-bg);
		color: var(--color-danger-tonal-text);
		border-color: var(--color-danger-tonal-border);
	}
	.book-card__action.book-card__action--not-interested-active:hover {
		background: var(--color-danger-tonal-bg-hover);
		color: var(--color-danger-tonal-text-hover);
		border-color: var(--color-danger-tonal-border-hover);
	}

	.book-card__rating-wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: center;
		width: 100%;
		min-width: 0;
	}
	.book-card__action--rate-not-interested {
		margin-top: var(--space-1);
		align-self: stretch;
		max-width: 100%;
	}
	.book-card[data-context='rate'] .book-card__rating-wrap {
		align-items: stretch;
	}
	.book-card__back {
		background: none;
		border: none;
		padding: 0;
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.book-card__back:hover {
		color: var(--color-text);
	}
	.book-card__back:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}

	.book-card__rating {
		display: flex;
		gap: 0;
		justify-content: center;
		align-items: center;
		flex-wrap: nowrap;
		white-space: nowrap;
		min-width: min-content;
	}
	.book-card[data-context='rate'] .book-card__rating {
		justify-content: flex-start;
	}

	.book-card__star {
		min-width: var(--book-card-star-min, 2.25rem);
		min-height: var(--book-card-star-min, 2.25rem);
		padding: var(--space-1);
		font-family: var(--typ-interactive-1-font-family);
		font-size: var(--book-card-star-font, 1.375rem);
		line-height: 1;
		letter-spacing: var(--typ-interactive-1-letter-spacing);
		border: none;
		background: transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
		color: var(--color-text-muted);
	}
	.book-card__star:hover {
		background: var(--color-bg-hover);
		color: var(--color-text);
	}
	.book-card__star:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.book-card__star--active {
		background: transparent;
		color: var(--color-text);
	}

	@media (max-width: 479px) {
		.book-card__rating {
			min-width: 0;
		}
		.book-card__star {
			min-width: var(--book-card-star-min-sm, 1.75rem);
			min-height: var(--book-card-star-min-sm, 1.75rem);
			font-size: var(--book-card-star-font-sm, 1.1rem);
			padding: 2px;
		}
	}

	.book-card__summary-overlay {
		position: absolute;
		inset: 0;
		z-index: 10;
		background: var(--color-card-bg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: var(--book-card-radius, var(--radius));
	}
	.book-card__summary-close {
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
		background: var(--color-floating-control-bg);
		border-radius: var(--radius-pill);
		cursor: pointer;
		color: var(--color-text);
		transition: background var(--duration-fast) var(--ease-default);
	}
	.book-card__summary-close:hover {
		background: var(--color-floating-control-bg-hover);
	}
	.book-card__summary-close:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.book-card__summary-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px var(--space-3) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
	}
	.book-card__summary-content::-webkit-scrollbar {
		width: 3px;
	}
	.book-card__summary-content::-webkit-scrollbar-track {
		background: transparent;
	}
	.book-card__summary-content::-webkit-scrollbar-thumb {
		background: var(--color-border);
		border-radius: var(--radius-pill);
	}
	.book-card__summary-content::-webkit-scrollbar-thumb:hover {
		background: var(--color-border-hover);
	}
	.book-card__title {
		font-family: var(--typ-h3-font-family);
		font-size: var(--typ-h3-font-size);
		font-weight: var(--typ-h3-font-weight);
		line-height: var(--typ-h3-line-height);
		letter-spacing: var(--typ-h3-letter-spacing);
		margin: 0;
		color: var(--color-text);
	}
	.book-card__author {
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-text-muted);
		margin: 0;
	}
	.book-card__summary {
		font-family: var(--typ-body-font-family);
		font-size: var(--typ-body-font-size);
		font-weight: var(--typ-body-font-weight);
		line-height: var(--typ-body-line-height);
		letter-spacing: var(--typ-body-letter-spacing);
		color: var(--color-text);
		margin: 0;
	}
	.book-card__summary-search {
		padding-top: var(--space-1);
	}
	.book-card__summary-search-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text);
		background: var(--color-bg-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default);
	}
	.book-card__summary-search-btn:hover {
		background: var(--color-bg-hover);
	}
	.book-card__summary-search-btn:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.book-card__genres {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.book-card__genre {
		padding: var(--space-1) var(--space-2);
		font-family: var(--typ-interactive-1-font-family);
		font-size: var(--typ-interactive-1-font-size);
		font-weight: var(--typ-interactive-1-font-weight);
		line-height: var(--typ-interactive-1-line-height);
		letter-spacing: var(--typ-interactive-1-letter-spacing);
		background: var(--color-bg-muted);
		border-radius: var(--radius-pill);
		color: var(--color-text);
	}
	@media (prefers-color-scheme: dark) {
		.book-card__genre {
			background: var(--color-bg-hover);
			color: var(--color-text);
		}
	}
</style>
