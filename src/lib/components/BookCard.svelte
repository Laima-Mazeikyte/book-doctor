  <script lang="ts">
	import { tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { BookOpenText, X, Bookmark, Star, Ban, Search, ArrowLeft } from 'lucide-svelte';
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

	$effect(() => {
		if (notInterested) pendingRate = false;
	});

	const RATING_OPTIONS: RatingValue[] = [1, 2, 3, 4, 5];
	const STAR_FILLED = '★';
	const STAR_EMPTY = '☆';

	const ratingFromStore = $derived($ratingsStore.get(book.id));
	const currentRating = $derived(
		isRateContext ? ratingFromStore ?? null : (currentRatingProp ?? null)
	);

	const showOnlyStars = $derived(!isRateContext && currentRating != null);

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

	const summaryPanelId = $derived(`book-summary-panel-${book.id}`);
	const summaryTitleId = $derived(`book-summary-title-${book.id}`);

	const SUMMARY_DRAWER_DESKTOP_PX = 400;
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

{#snippet recommendationRateMorph(bm: boolean, ni: boolean)}
	<div
		class="book-card__recommendation-controls"
		class:book-card__recommendation-controls--rating-open={pendingRate}
		aria-live="polite"
	>
		<div
			class="book-card__reco-layer book-card__reco-layer--actions"
			inert={pendingRate}
			aria-hidden={pendingRate ? true : undefined}
		>
			<div class="book-card__actions">
				{#if !ni}
					<button
						type="button"
						class="book-card__action"
						class:book-card__action--saved={bm}
						class:book-card__action--labeled={bm}
						class:book-card__action--reco-hoverable={!bm}
						aria-pressed={bm}
						aria-label={bm
							? t('shared.recommendationCard.removeFromReadingList')
							: t('shared.recommendationCard.addToReadingList')}
						onclick={handleBookmarkClick}
					>
						<Bookmark size={14} aria-hidden="true" />
						{#if bm}
							<span class="book-card__action-label">{t('shared.recommendationCard.saved')}</span>
						{:else}
							<span class="book-card__action-label book-card__action-label--reco-hover-hint" aria-hidden="true">{t('shared.recommendationCard.bookmark')}</span>
						{/if}
					</button>
					<button
						type="button"
						class="book-card__action book-card__action--reco-hoverable"
						aria-pressed="false"
						aria-label={t('shared.recommendationCard.markAsRead')}
						onclick={handleReadClick}
					>
						<Star size={14} aria-hidden="true" />
						<span class="book-card__action-label book-card__action-label--reco-hover-hint" aria-hidden="true">{t('shared.recommendationCard.read')}</span>
					</button>
				{/if}
				{#if onNotInterested}
					<button
						type="button"
						class="book-card__action"
						class:book-card__action--not-interested-active={ni}
						class:book-card__action--labeled={ni}
						class:book-card__action--reco-hoverable={!ni}
						aria-pressed={ni}
						aria-label={ni
							? t('shared.recommendationCard.removeFromNotInterested')
							: t('shared.recommendationCard.notInterested')}
						onclick={handleNotInterestedClick}
					>
						<Ban size={14} aria-hidden="true" />
						{#if ni}
							<span class="book-card__action-label">{t('shared.recommendationCard.notInterested')}</span>
						{:else}
							<span class="book-card__action-label book-card__action-label--reco-hover-hint" aria-hidden="true">{t('shared.recommendationCard.notInterested')}</span>
						{/if}
					</button>
				{/if}
			</div>
		</div>
		<div
			class="book-card__reco-layer book-card__reco-layer--rating"
			inert={!pendingRate}
			aria-hidden={!pendingRate ? true : undefined}
		>
			<div class="book-card__rating-wrap book-card__rating-wrap--reco-morph">
				<div
					class="book-card__rating"
					role="group"
					aria-label={t('shared.recommendationCard.rateThisBook')}
					onmouseleave={() => (hoverRating = 0)}
				>
					{#each RATING_OPTIONS as value}
						<button
							type="button"
							class="book-card__star book-card__star--reco-morph"
							class:book-card__star--active={displayRating >= value}
							aria-label={starAriaLabel(value)}
							aria-pressed={starAriaPressed(value)}
							onmouseenter={() => (hoverRating = value)}
							onclick={() => {
								hoverRating = 0;
								handleStarClick(value);
							}}
						>
							<span aria-hidden="true">
								{displayRating >= value ? STAR_FILLED : STAR_EMPTY}
							</span>
						</button>
					{/each}
				</div>
				<div class="book-card__back-slot">
					<button
						type="button"
						class="book-card__back"
						aria-label={t('shared.recommendationCard.backToWantToRead')}
						onclick={() => (pendingRate = false)}
					>
						<ArrowLeft size={14} aria-hidden="true" />
					</button>
				</div>
			</div>
		</div>
	</div>
{/snippet}

<article
	class="book-card"
	data-book-id={book.id}
	data-context={context}
	aria-label="{book.title} by {book.author}"
>
	<div class="book-card__media">
		<div class="book-card__media-inner" class:book-card__media-inner--not-interested={notInterested}>
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
				class="book-card__action book-card__action--reco-hoverable book-card__summary-action"
				aria-label={t('shared.recommendationCard.seeSummary')}
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

	<div class="book-card__body">
		{#if isRateContext}
			<div class="book-card__rating-wrap">
				<div
					class="book-card__rating"
					role="group"
					aria-label={t('shared.bookCard.rateThisBook')}
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
								hoverRating = 0;
								handleStarClick(value);
							}}
						>
							<span aria-hidden="true">
								{displayRating >= value ? STAR_FILLED : STAR_EMPTY}
							</span>
						</button>
					{/each}
				</div>
				{#if onNotInterested}
					<button
						type="button"
						class="book-card__action book-card__action--rate-not-interested"
						class:book-card__action--not-interested-active={notInterested}
						class:book-card__action--labeled={notInterested}
						aria-pressed={notInterested}
						aria-label={notInterested
							? t('shared.recommendationCard.removeFromNotInterested')
							: t('shared.recommendationCard.notInterested')}
						onclick={handleNotInterestedClick}
					>
						<Ban size={14} aria-hidden="true" />
						{#if notInterested}
							<span class="book-card__action-label">{t('shared.recommendationCard.notInterested')}</span>
						{/if}
					</button>
				{/if}
			</div>
		{:else if showOnlyStars}
			<div class="book-card__rating-wrap">
				<div
					class="book-card__rating"
					role="group"
					aria-label={t('shared.recommendationCard.rateThisBook')}
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
								hoverRating = 0;
								handleStarClick(value);
							}}
						>
							<span aria-hidden="true">
								{displayRating >= value ? STAR_FILLED : STAR_EMPTY}
							</span>
						</button>
					{/each}
				</div>
			</div>
		{:else}
			{@render recommendationRateMorph(bookmarked, notInterested)}
		{/if}
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
			<div class="book-card__summary-content">
				{#if book.genres && book.genres.length > 0}
					<ul class="book-card__genres" aria-label={t('shared.recommendationCard.genres')}>
						{#each book.genres as genre}
							<li class="book-card__genre">{genre}</li>
						{/each}
					</ul>
				{/if}
				<h3 class="book-card__title" id={summaryTitleId}>{book.title}</h3>
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

				{#if isRateContext}
					<div class="book-card__rating-wrap">
						<div
							class="book-card__rating"
							role="group"
							aria-label={t('shared.bookCard.rateThisBook')}
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
										hoverRating = 0;
										handleStarClick(value);
									}}
								>
									<span aria-hidden="true">
										{displayRating >= value ? STAR_FILLED : STAR_EMPTY}
									</span>
								</button>
							{/each}
						</div>
						{#if onNotInterested}
							<button
								type="button"
								class="book-card__action book-card__action--rate-not-interested"
								class:book-card__action--not-interested-active={notInterested}
								class:book-card__action--labeled={notInterested}
								aria-pressed={notInterested}
								aria-label={notInterested
									? t('shared.recommendationCard.removeFromNotInterested')
									: t('shared.recommendationCard.notInterested')}
								onclick={handleNotInterestedClick}
							>
								<Ban size={14} aria-hidden="true" />
								{#if notInterested}
									<span class="book-card__action-label">{t('shared.recommendationCard.notInterested')}</span>
								{/if}
							</button>
						{/if}
					</div>
				{:else if showOnlyStars}
					<div class="book-card__rating-wrap">
						<div
							class="book-card__rating"
							role="group"
							aria-label={t('shared.recommendationCard.rateThisBook')}
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
										hoverRating = 0;
										handleStarClick(value);
									}}
								>
									<span aria-hidden="true">
										{displayRating >= value ? STAR_FILLED : STAR_EMPTY}
									</span>
								</button>
							{/each}
						</div>
					</div>
				{:else}
					{@render recommendationRateMorph(bookmarked, notInterested)}
				{/if}
			</div>
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
	.book-card__media-inner--not-interested .book-card__cover {
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
		color: var(--color-text);
	}
	.book-card__year {
		opacity: 0.75;
	}

	.book-card__summary-action {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		z-index: 2;
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

	/* Recommendations (unrated): crossfade + scale; active layer in-flow so height hugs content */
	.book-card__recommendation-controls {
		--book-card-reco-dur: 0.34s;
		--book-card-reco-ease: cubic-bezier(0.33, 1, 0.68, 1);
		position: relative;
		width: 100%;
		overflow: hidden;
	}
	.book-card__reco-layer {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		transition:
			opacity var(--book-card-reco-dur) var(--book-card-reco-ease),
			transform var(--book-card-reco-dur) var(--book-card-reco-ease);
		transform-origin: 50% 0;
	}
	.book-card__reco-layer--actions {
		position: relative;
		z-index: 2;
		opacity: 1;
		transform: scale(1);
		pointer-events: auto;
	}
	.book-card__reco-layer--rating {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		z-index: 1;
		opacity: 0;
		transform: scale(0.92);
		pointer-events: none;
	}
	.book-card__recommendation-controls--rating-open .book-card__reco-layer--actions {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		z-index: 1;
		opacity: 0;
		transform: scale(0.88);
		pointer-events: none;
	}
	.book-card__recommendation-controls--rating-open .book-card__reco-layer--rating {
		position: relative;
		left: auto;
		right: auto;
		top: auto;
		z-index: 2;
		opacity: 1;
		transform: scale(1);
		pointer-events: auto;
	}
	.book-card__rating-wrap--reco-morph {
		width: 100%;
		align-items: center;
	}
	.book-card__reco-layer--rating .book-card__star--reco-morph {
		transition-property: transform, opacity;
		transition-duration: 0.3s;
		transition-timing-function: cubic-bezier(0.34, 1.12, 0.64, 1);
		transition-delay: 0s;
		transform: scale(0.58);
		opacity: 0;
	}
	.book-card__recommendation-controls--rating-open
		.book-card__reco-layer--rating
		.book-card__star--reco-morph:nth-child(1) {
		transition-delay: 0.04s;
	}
	.book-card__recommendation-controls--rating-open
		.book-card__reco-layer--rating
		.book-card__star--reco-morph:nth-child(2) {
		transition-delay: 0.07s;
	}
	.book-card__recommendation-controls--rating-open
		.book-card__reco-layer--rating
		.book-card__star--reco-morph:nth-child(3) {
		transition-delay: 0.1s;
	}
	.book-card__recommendation-controls--rating-open
		.book-card__reco-layer--rating
		.book-card__star--reco-morph:nth-child(4) {
		transition-delay: 0.13s;
	}
	.book-card__recommendation-controls--rating-open
		.book-card__reco-layer--rating
		.book-card__star--reco-morph:nth-child(5) {
		transition-delay: 0.16s;
	}
	.book-card__recommendation-controls--rating-open .book-card__reco-layer--rating .book-card__star--reco-morph {
		transform: scale(1);
		opacity: 1;
	}
	.book-card__back-slot {
		display: flex;
		justify-content: center;
		width: 100%;
		transition:
			opacity 0.26s ease,
			transform 0.28s var(--book-card-reco-ease);
	}
	.book-card__recommendation-controls:not(.book-card__recommendation-controls--rating-open) .book-card__back-slot {
		opacity: 0;
		transform: translateY(0.45rem);
		transition-delay: 0s;
		pointer-events: none;
	}
	.book-card__recommendation-controls--rating-open .book-card__back-slot {
		opacity: 1;
		transform: translateY(0);
		transition-delay: 0.14s;
		pointer-events: auto;
	}
	@media (prefers-reduced-motion: reduce) {
		.book-card__recommendation-controls {
			--book-card-reco-dur: 0.01ms;
		}
		.book-card__reco-layer,
		.book-card__reco-layer--rating .book-card__star--reco-morph,
		.book-card__back-slot {
			transition-duration: 0.01ms !important;
			transition-delay: 0ms !important;
		}
		.book-card__reco-layer--actions .book-card__action--reco-hoverable,
		.book-card__reco-layer--actions .book-card__action--reco-hoverable .book-card__action-label--reco-hover-hint,
		.book-card__media-inner .book-card__action--reco-hoverable,
		.book-card__media-inner .book-card__action--reco-hoverable .book-card__action-label--reco-hover-hint {
			transition-duration: 0.01ms !important;
			transition-delay: 0ms !important;
		}
	}

	.book-card__actions {
		display: flex;
		flex-wrap: nowrap;
		gap: var(--space-2);
		align-items: center;
		justify-content: center;
		width: 100%;
		min-width: 0;
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
		background: var(--color-bg-hover);
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
		.book-card__reco-layer--actions .book-card__action--reco-hoverable,
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
		.book-card__reco-layer--actions .book-card__action--reco-hoverable .book-card__action-label--reco-hover-hint,
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
		.book-card__reco-layer--actions .book-card__action--reco-hoverable:hover .book-card__action-label--reco-hover-hint,
		.book-card__reco-layer--actions
			.book-card__action--reco-hoverable:focus-visible
			.book-card__action-label--reco-hover-hint,
		.book-card__media-inner .book-card__action--reco-hoverable:hover .book-card__action-label--reco-hover-hint,
		.book-card__media-inner
			.book-card__action--reco-hoverable:focus-visible
			.book-card__action-label--reco-hover-hint {
			max-width: 12rem;
			opacity: 1;
		}
		.book-card__reco-layer--actions .book-card__action--reco-hoverable:hover,
		.book-card__reco-layer--actions .book-card__action--reco-hoverable:focus-visible,
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
		align-self: center;
	}
	.book-card[data-context='rate'] .book-card__rating-wrap {
		align-items: stretch;
	}
	.book-card__back {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		box-sizing: border-box;
		width: var(--book-card-action-height, 2.25rem);
		height: var(--book-card-action-height, 2.25rem);
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg-muted);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.book-card__back:hover {
		background: var(--color-bg-hover);
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
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--book-card-star-min, 2.25rem);
		height: var(--book-card-star-min, 2.25rem);
		min-width: var(--book-card-star-min, 2.25rem);
		min-height: var(--book-card-star-min, 2.25rem);
		padding: 0;
		font-family: var(--typ-interactive-1-font-family);
		font-size: var(--book-card-star-font, 1.375rem);
		line-height: 1;
		letter-spacing: var(--typ-interactive-1-letter-spacing);
		border: none;
		background: transparent;
		border-radius: var(--radius-pill);
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
			width: var(--book-card-star-min-sm, 1.75rem);
			height: var(--book-card-star-min-sm, 1.75rem);
			min-width: var(--book-card-star-min-sm, 1.75rem);
			min-height: var(--book-card-star-min-sm, 1.75rem);
			font-size: var(--book-card-star-font-sm, 1.1rem);
		}
	}

	.book-card__summary-dialog-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: var(--color-overlay-scrim-soft);
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	.book-card__summary-dialog-panel {
		position: relative;
		z-index: 1;
		width: 100%;
		max-width: 100%;
		max-height: min(85vh, 85dvh);
		background: var(--color-bg);
		box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.12);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: var(--radius) var(--radius) 0 0;
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	@media (min-width: 768px) {
		.book-card__summary-dialog-overlay {
			align-items: stretch;
			justify-content: flex-start;
		}
		.book-card__summary-dialog-panel {
			width: min(400px, 85vw);
			min-width: 320px;
			max-width: 400px;
			height: 100%;
			max-height: none;
			border-radius: 0;
			box-shadow: var(--shadow-drawer);
			padding-bottom: 0;
		}
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
		gap: var(--space-2);
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.book-card__genre {
		padding-block: var(--space-2);
		padding-inline: var(--space-4);
		font-family: var(--typ-interactive-1-font-family);
		font-size: var(--typ-interactive-1-font-size);
		font-weight: var(--typ-interactive-1-font-weight);
		line-height: var(--typ-interactive-1-line-height);
		letter-spacing: var(--typ-interactive-1-letter-spacing);
		background: var(--color-book-card-tag-bg);
		border-radius: var(--radius-pill);
		color: var(--color-book-card-tag-text);
		border: none;
	}
</style>
