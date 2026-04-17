  <script lang="ts">
	import { tick } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { markRateSearchOpenedFromOtherRoute } from '$lib/rateSearchExternalNav';
	import { fly } from 'svelte/transition';
	import { BookOpenText, X, Bookmark, Star, Ban } from 'lucide-svelte';
	import { ratingsStore } from '$lib/stores/ratings';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';
	import type { BookCardListProps } from './book-card/types';
	import BookRatingStarsRow from './book-card/BookRatingStarsRow.svelte';
	import BookSummarySheetBody from './book-card/BookSummarySheetBody.svelte';
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
	let hoverRating = $state<number>(0);

	const ratingFromStore = $derived($ratingsStore.get(book.id));
	const currentRating = $derived(
		isRateContext ? ratingFromStore ?? null : (currentRatingProp ?? null)
	);

	const starRowAriaGroupLabel = $derived(
		isRateContext ? t('shared.bookCard.rateThisBook') : t('shared.recommendationCard.rateThisBook')
	);

	const displayRating = $derived(
		hoverRating > 0
			? hoverRating
			: isRateContext
				? (ratingFromStore ?? 0)
				: (currentRating ?? 0)
	);

	const showCoverImage = $derived(Boolean(book.coverUrl) && !coverImageFailed);
	const displaySummary = $derived(getBookDisplaySummary(book));
	const showSearchAuthorInOverlay = $derived(Boolean(book.author?.trim()));
	const showAuthorInSheetMeta = $derived(Boolean(book.author?.trim()));
	const canRemoveRatingInSheet = $derived(
		isRateContext ? ratingFromStore != null : currentRating != null
	);
	const showSummaryBookmarkAction = $derived(Boolean(onBookmark));
	const showSummaryNotInterestedAction = $derived(Boolean(onNotInterested));

	const summaryPanelId = $derived(`book-summary-panel-${book.id}`);
	const summaryTitleId = $derived(`book-summary-title-${book.id}`);

	const bookIdentityAriaLabel = $derived(
		book.author?.trim()
			? t('shared.recommendationCard.bookCardIdentityAriaLabelWithAuthor', {
					title: book.title,
					author: book.author.trim()
				})
			: t('shared.recommendationCard.bookCardIdentityAriaLabelTitleOnly', { title: book.title })
	);

	const coverOpenSummaryAriaLabel = $derived(
		book.author?.trim()
			? t('shared.recommendationCard.seeSummaryCoverAriaLabelWithAuthor', {
					title: book.title,
					author: book.author.trim()
				})
			: t('shared.recommendationCard.seeSummaryCoverAriaLabelTitleOnly', { title: book.title })
	);

	const SUMMARY_DRAWER_DESKTOP_PX = 400;
	/** Cap fly distance on very tall viewports (full-screen mobile slide). */
	const SUMMARY_SHEET_SLIDE_MAX_PX = 900;

	let flySlideX = $state(0);
	let flySlideY = $state(0);

	function portal(node: HTMLElement, target: HTMLElement = document.body) {
		target.appendChild(node);
		return {
			destroy() {
				node.parentNode?.removeChild(node);
			}
		};
	}

	function setSummaryFlyDistance() {
		if (typeof window === 'undefined') {
			flySlideX = -SUMMARY_DRAWER_DESKTOP_PX;
			flySlideY = 0;
			return;
		}
		if (window.matchMedia('(min-width: 768px)').matches) {
			flySlideX = -SUMMARY_DRAWER_DESKTOP_PX;
			flySlideY = 0;
		} else {
			flySlideX = 0;
			flySlideY = Math.min(window.innerHeight, SUMMARY_SHEET_SLIDE_MAX_PX);
		}
	}

	$effect(() => {
		if (!summaryOpen) return;
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	});

	function handleSummaryWindowKeydown(e: KeyboardEvent) {
		if (!summaryOpen) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			handleCloseSummary();
		}
	}

	function handleSummaryOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) handleCloseSummary();
	}

	function handleSummaryOverlayKeydown(e: KeyboardEvent) {
		if (e.target !== e.currentTarget) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleCloseSummary();
		}
	}

	async function handleOpenSummary() {
		setSummaryFlyDistance();
		summaryOpen = true;
		await tick();
		closeBtnRef?.focus();
	}

	async function handleCloseSummary() {
		summaryOpen = false;
		await tick();
		summaryBtnRef?.focus();
	}

	function handleBookmarkClick(e: MouseEvent) {
		e.stopPropagation();
		onBookmark?.(book.id);
	}

	function handleNotInterestedClick(e: MouseEvent) {
		e.stopPropagation();
		onNotInterested?.(book.id);
	}

	function handleSummaryAuthorPillClick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const author = book.author.trim();
		if (onSearchAuthor) {
			onSearchAuthor(book.author);
		} else {
			if (browser) markRateSearchOpenedFromOtherRoute();
			void goto(resolve(`/rate?q=${encodeURIComponent(author)}`));
		}
		handleCloseSummary();
	}

	function handleSheetRemoveRating(e: MouseEvent) {
		e.stopPropagation();
		hoverRating = 0;
		if (isRateContext) {
			ratingsStore.removeRating(book.id, book.book_id);
			onAfterRate?.(book);
		} else {
			onRemoveRating?.(book.id);
		}
	}

	function starHoverPreviewSupported(): boolean {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
	}

	function handleStarMouseEnter(value: RatingValue) {
		if (starHoverPreviewSupported()) hoverRating = value;
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
		} else {
			onRate?.(book.id, value);
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
	aria-label={bookIdentityAriaLabel}
>
	<div class="book-card__media" role="group" aria-label={bookIdentityAriaLabel}>
		<div class="book-card__media-inner" class:book-card__media-inner--not-interested={notInterested}>
			{#if showCoverImage}
				<button
					type="button"
					class="book-card__cover-hit"
					aria-label={coverOpenSummaryAriaLabel}
					aria-expanded={summaryOpen}
					aria-controls={summaryOpen ? summaryPanelId : undefined}
					onclick={() => void handleOpenSummary()}
				>
					<img
						src={book.coverUrl}
						alt=""
						class="book-card__cover"
						onerror={() => (coverImageFailed = true)}
					/>
				</button>
			{:else}
				<button
					type="button"
					class="book-card__cover book-card__cover--no-image book-card__cover--opens-summary"
					aria-label={coverOpenSummaryAriaLabel}
					aria-expanded={summaryOpen}
					aria-controls={summaryOpen ? summaryPanelId : undefined}
					onclick={() => void handleOpenSummary()}
				>
					<span class="book-card__placeholder-author">{book.author}{#if book.year}<span class="book-card__year"> · {book.year}</span>{/if}</span>
					<span class="book-card__placeholder-title">{book.title}</span>
				</button>
			{/if}
			{#if onBookmark}
				<div class="book-card__cover-actions book-card__cover-actions--tl">
					<button
						type="button"
						tabindex={-1}
						class="book-card__action"
						class:book-card__action--saved={bookmarked}
						class:book-card__action--labeled={bookmarked}
						class:book-card__action--reco-hoverable={!bookmarked}
						aria-pressed={bookmarked}
						aria-label={bookmarked
							? t('shared.recommendationCard.removeFromReadingList')
							: t('shared.recommendationCard.addToReadingList')}
						onclick={handleBookmarkClick}
					>
						<Bookmark size={14} aria-hidden="true" />
						{#if bookmarked}
							<span class="book-card__action-label">{t('shared.recommendationCard.saved')}</span>
						{:else}
							<span class="book-card__action-label book-card__action-label--reco-hover-hint" aria-hidden="true">
								{t('shared.recommendationCard.bookmark')}
							</span>
						{/if}
					</button>
				</div>
			{/if}
			{#if onNotInterested}
				<div class="book-card__cover-actions book-card__cover-actions--br">
					<button
						type="button"
						tabindex={-1}
						class="book-card__action"
						class:book-card__action--not-interested-active={notInterested}
						class:book-card__action--labeled={notInterested}
						class:book-card__action--reco-hoverable={!notInterested}
						aria-pressed={notInterested}
						aria-label={notInterested
							? t('shared.recommendationCard.removeFromNotInterested')
							: t('shared.recommendationCard.notInterested')}
						onclick={handleNotInterestedClick}
					>
						<Ban size={14} aria-hidden="true" />
						{#if notInterested}
							<span class="book-card__action-label">{t('shared.recommendationCard.notInterested')}</span>
						{:else}
							<span class="book-card__action-label book-card__action-label--reco-hover-hint" aria-hidden="true">
								{t('shared.recommendationCard.notInterested')}
							</span>
						{/if}
					</button>
				</div>
			{/if}
			<div class="book-card__cover-actions book-card__cover-actions--tr">
				<button
					bind:this={summaryBtnRef}
					type="button"
					tabindex={-1}
					class="book-card__action book-card__action--reco-hoverable"
					aria-label={coverOpenSummaryAriaLabel}
					aria-expanded={summaryOpen}
					aria-controls={summaryOpen ? summaryPanelId : undefined}
					onclick={handleOpenSummary}
				>
					<BookOpenText size={14} aria-hidden="true" />
					<span class="book-card__action-label book-card__action-label--reco-hover-hint" aria-hidden="true">
						{t('shared.recommendationCard.summary')}
					</span>
				</button>
			</div>
		</div>
	</div>

	<div class="book-card__body">
		<BookRatingStarsRow
			ratingWrapWidth="auto"
			displayRating={displayRating}
			ariaGroupLabel={starRowAriaGroupLabel}
			starAriaLabel={starAriaLabel}
			starAriaPressed={starAriaPressed}
			onmouseleave={() => (hoverRating = 0)}
			onstarEnter={handleStarMouseEnter}
			onstarClick={(value) => {
				hoverRating = 0;
				handleStarClick(value);
			}}
		/>
	</div>
</article>

<svelte:window onkeydown={handleSummaryWindowKeydown} />

{#if summaryOpen}
	<div
		use:portal
		class="book-card__summary-dialog-overlay"
		role="dialog"
		aria-modal="true"
		aria-labelledby={summaryTitleId}
		tabindex="-1"
		onclick={handleSummaryOverlayClick}
		onkeydown={handleSummaryOverlayKeydown}
	>
		<div
			id={summaryPanelId}
			class="book-card__summary-dialog-panel"
			in:fly={{ x: flySlideX, y: flySlideY, duration: 200 }}
			out:fly={{ x: flySlideX, y: flySlideY, duration: 150 }}
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
			<BookSummarySheetBody
				{book}
				summaryTitleId={summaryTitleId}
				displaySummary={displaySummary}
				showCoverImage={showCoverImage}
				onCoverImageError={() => (coverImageFailed = true)}
				showAuthorInSheetMeta={showAuthorInSheetMeta}
				showSearchAuthorInOverlay={showSearchAuthorInOverlay}
				onAuthorPillClick={showSearchAuthorInOverlay ? handleSummaryAuthorPillClick : undefined}
				{notInterested}
				ratingGroupAriaLabel={isRateContext
					? t('shared.bookCard.rateThisBook')
					: t('shared.recommendationCard.rateThisBook')}
				{displayRating}
				starAriaLabel={starAriaLabel}
				starAriaPressed={starAriaPressed}
				onStarMouseEnter={handleStarMouseEnter}
				onStarClick={(value) => {
					hoverRating = 0;
					handleStarClick(value);
				}}
				onRatingGroupMouseLeave={() => (hoverRating = 0)}
				canRemoveRatingInSheet={canRemoveRatingInSheet}
				reserveSummaryRemoveLayoutSlot={isRateContext}
				onRemoveRatingClick={handleSheetRemoveRating}
				showBookmarkAction={showSummaryBookmarkAction}
				showNotInterestedAction={showSummaryNotInterestedAction}
				{bookmarked}
				onBookmarkClick={handleBookmarkClick}
				onNotInterestedClick={handleNotInterestedClick}
			/>
		</div>
	</div>
{/if}

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
		transition: transform var(--duration-normal) var(--ease-default),
			opacity var(--duration-fast) var(--ease-default);
	}
	.book-card__cover-hit {
		position: relative;
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		margin: 0;
		border: none;
		background: transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	/* Inset box-shadow on the button sits under the cover <img>; draw the ring in ::after above the image. */
	.book-card__cover-hit:focus-visible {
		outline: none;
	}
	.book-card__cover-hit:focus-visible::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 0 2px var(--color-focus);
		pointer-events: none;
		z-index: 1;
	}
	.book-card__cover--opens-summary {
		position: relative;
		cursor: pointer;
		appearance: none;
		padding: 0;
		margin: 0;
		border: none;
		background: transparent;
		font: inherit;
		text-align: left;
		color: inherit;
	}
	.book-card__cover--opens-summary:focus-visible {
		outline: none;
	}
	.book-card__cover--opens-summary:focus-visible::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 0 2px var(--color-focus);
		pointer-events: none;
		z-index: 1;
	}
	.book-card__media-inner--not-interested .book-card__cover:not(.book-card__cover--no-image) {
		opacity: 0.3;
	}
	.book-card__media-inner--not-interested .book-card__cover--no-image .book-card__placeholder-author,
	.book-card__media-inner--not-interested .book-card__cover--no-image .book-card__placeholder-title {
		opacity: 0.3;
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
		color: var(--color-book-title);
	}
	.book-card__year {
		opacity: 0.75;
	}

	.book-card__cover-actions {
		position: absolute;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.book-card__cover-actions--tr {
		top: var(--space-2);
		right: var(--space-2);
		align-items: flex-end;
	}
	.book-card__cover-actions--tl {
		top: var(--space-2);
		left: var(--space-2);
		align-items: flex-start;
	}
	.book-card__cover-actions--br {
		bottom: var(--space-2);
		right: var(--space-2);
		align-items: flex-end;
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

	.book-card[data-context='rate'] .book-card__body,
	.book-card[data-context='recommendations'] .book-card__body,
	.book-card[data-context='bookmarks'] .book-card__body,
	.book-card[data-context='rated'] .book-card__body,
	.book-card[data-context='not-interested'] .book-card__body {
		justify-content: center;
		align-items: center;
	}

	@media (prefers-reduced-motion: reduce) {
		.book-card__media-inner .book-card__action--reco-hoverable,
		.book-card__media-inner .book-card__action--reco-hoverable .book-card__action-label--reco-hover-hint {
			transition-duration: 0.01ms !important;
			transition-delay: 0ms !important;
		}
	}

	.book-card__action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		box-sizing: border-box;
		width: var(--book-card-action-height, 2.25rem);
		height: var(--book-card-action-height, 2.25rem);
		min-width: var(--book-card-action-height, 2.25rem);
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg-muted);
		color: var(--color-text);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.book-card__action:hover {
		background: var(--color-book-card-action-hover-bg);
	}
	.book-card__action:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.book-card__action :global(svg) {
		flex-shrink: 0;
	}
	.book-card__action.book-card__action--labeled {
		width: max-content;
		max-width: 100%;
		min-width: var(--book-card-action-height, 2.25rem);
		padding-block: 0;
		padding-inline-start: var(--space-2);
		padding-inline-end: var(--space-3);
		gap: var(--space-1);
		flex-shrink: 0;
	}
	.book-card__action-label {
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: 1;
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		white-space: nowrap;
		max-width: 12rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (max-width: 479px) {
		.book-card__action-label--reco-hover-hint {
			display: none;
		}
	}

	/*
	 * Wide viewports: inactive Save / Not interested stay icon-only until :hover or :focus-visible.
	 * Collapsed rules apply from 480px up so touch tablets don’t show hint text without animation layout.
	 */
	@media (min-width: 480px) {
		.book-card__media-inner .book-card__action--reco-hoverable {
			width: auto;
			min-width: var(--book-card-action-height, 2.25rem);
			max-width: 100%;
			padding-inline: 0;
			gap: 0;
			transition:
				padding-inline 0.3s var(--ease-default),
				gap 0.3s var(--ease-default),
				background var(--duration-fast) var(--ease-default),
				color var(--duration-fast) var(--ease-default),
				border-color var(--duration-fast) var(--ease-default);
		}
		.book-card__media-inner .book-card__action--reco-hoverable .book-card__action-label--reco-hover-hint {
			display: inline-block;
			max-width: 0;
			opacity: 0;
			overflow: hidden;
			vertical-align: middle;
			transition:
				max-width 0.32s var(--ease-default),
				opacity 0.22s var(--ease-default);
		}
		.book-card__media-inner .book-card__action--reco-hoverable:hover .book-card__action-label--reco-hover-hint,
		.book-card__media-inner
			.book-card__action--reco-hoverable:focus-visible
			.book-card__action-label--reco-hover-hint {
			max-width: 12rem;
			opacity: 1;
		}
		.book-card__media-inner .book-card__action--reco-hoverable:hover,
		.book-card__media-inner .book-card__action--reco-hoverable:focus-visible {
			padding-inline-start: var(--space-2);
			padding-inline-end: var(--space-3);
			gap: var(--space-1);
		}
	}
	.book-card__action--saved {
		background: var(--color-book-card-chip-on-bg);
		color: var(--color-book-card-chip-on-text);
		border-color: var(--color-book-card-chip-on-border);
	}
	.book-card__action--saved:hover {
		background: var(--color-book-card-chip-on-bg-hover);
	}
	.book-card__action.book-card__action--not-interested-active {
		background: var(--color-book-card-chip-on-bg);
		color: var(--color-book-card-chip-on-text);
		border-color: var(--color-book-card-chip-on-border);
	}
	.book-card__action.book-card__action--not-interested-active:hover {
		background: var(--color-book-card-chip-on-bg-hover);
		color: var(--color-book-card-chip-on-text);
		border-color: var(--color-book-card-chip-on-border);
	}

	.book-card[data-context='rate'] .book-card__rating-wrap,
	.book-card[data-context='recommendations'] .book-card__rating-wrap,
	.book-card[data-context='bookmarks'] .book-card__rating-wrap,
	.book-card[data-context='rated'] .book-card__rating-wrap,
	.book-card[data-context='not-interested'] .book-card__rating-wrap {
		align-items: center;
		width: auto;
	}

	.book-card__summary-dialog-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		/* Mobile: full-screen panel covers viewport; desktop: scrim beside drawer */
		background: transparent;
	}
	.book-card__summary-dialog-panel {
		position: absolute;
		inset: 0;
		z-index: 1;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-height: 100dvh;
		max-width: none;
		max-height: none;
		background: var(--color-card-bg);
		box-shadow: none;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: 0;
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	@media (min-width: 768px) {
		.book-card__summary-dialog-overlay {
			display: flex;
			align-items: stretch;
			justify-content: flex-start;
			background: var(--color-overlay-scrim-soft);
		}
		.book-card__summary-dialog-panel {
			position: relative;
			inset: auto;
			width: min(400px, 85vw);
			min-width: 320px;
			max-width: 400px;
			height: auto;
			align-self: stretch;
			min-height: 0;
			max-height: none;
			box-shadow: var(--shadow-drawer);
			padding-bottom: 0;
		}
	}
	.book-card__summary-close {
		position: absolute;
		top: calc(var(--space-2) + env(safe-area-inset-top, 0px));
		right: calc(var(--space-2) + env(safe-area-inset-right, 0px));
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
	/* Cover + card row: inactive action pills use elevated surface (summary sheet body uses book-summary-sheet-body.css) */
	.book-card__media-inner
		.book-card__action:not(.book-card__action--saved):not(
			.book-card__action--not-interested-active
		) {
		background: var(--color-book-card-pill-surface-bg);
	}
	.book-card__media-inner
		.book-card__action:not(.book-card__action--saved):not(
			.book-card__action--not-interested-active
		):hover {
		background: var(--color-book-card-pill-surface-bg-hover);
	}

	.book-card__media-inner
		.book-card__action:not(.book-card__action--saved):not(
			.book-card__action--not-interested-active
		) {
		border-color: var(--color-border-hover);
	}

	/* Cover tint: deep aqua (does not remap in dark like --primitive-gray-900). */
	.book-card__media-inner .book-card__cover-actions {
		--book-card-cover-tint: var(--primitive-deep-aqua);
		--book-card-cover-chip-hover-solid: color-mix(
			in srgb,
			var(--primitive-deep-aqua) 88%,
			var(--primitive-white)
		);
	}

	/* Cover overlay actions only: frosted glass (overrides pill-surface rules above) */
	.book-card__media-inner .book-card__cover-actions .book-card__action {
		border: none;
		color: var(--primitive-white);
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
	}

	/* Selected chip on cover: base rule above wins specificity over .book-card__action--saved; restore contrast */
	.book-card__media-inner .book-card__cover-actions .book-card__action.book-card__action--saved,
	.book-card__media-inner
		.book-card__cover-actions
		.book-card__action.book-card__action--not-interested-active {
		color: var(--color-book-card-chip-on-text);
	}

	.book-card__media-inner .book-card__cover-actions
		.book-card__action:not(.book-card__action--saved):not(.book-card__action--not-interested-active) {
		background: color-mix(in srgb, var(--book-card-cover-tint) 12%, transparent);
	}

	.book-card__media-inner .book-card__cover-actions
		.book-card__action:not(.book-card__action--saved):not(
			.book-card__action--not-interested-active
		):hover,
	.book-card__media-inner .book-card__cover-actions
		.book-card__action:not(.book-card__action--saved):not(
			.book-card__action--not-interested-active
		):focus-visible {
		background: color-mix(in srgb, var(--book-card-cover-tint) 30%, transparent);
	}
</style>
