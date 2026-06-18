<script lang="ts">
	import { Bookmark, ThumbsDown, Search, Star } from 'lucide-svelte';
	import Button from '$lib/components/Button.svelte';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';

	const RATING_OPTIONS: RatingValue[] = [1, 2, 3, 4, 5];

	interface Props {
		book: Book;
		summaryTitleId: string;
		displaySummary: string;
		showCoverImage: boolean;
		onCoverImageError?: () => void;
		showAuthorInSheetMeta: boolean;
		/** When true, author is a search pill if `onAuthorPillClick` is set; otherwise plain text. */
		showSearchAuthorInOverlay: boolean;
		onAuthorPillClick?: (e: MouseEvent) => void;
		notInterested: boolean;
		ratingGroupAriaLabel: string;
		displayRating: number;
		starAriaLabel: (value: RatingValue) => string;
		starAriaPressed: (value: RatingValue) => boolean;
		onStarMouseEnter: (value: RatingValue) => void;
		onStarClick: (value: RatingValue) => void;
		onRatingGroupMouseLeave?: () => void;
		canRemoveRatingInSheet: boolean;
		onRemoveRatingClick: (e: MouseEvent) => void;
		/**
		 * When true and there is no rating yet, an invisible remove control still occupies
		 * layout width so stars do not jump when the real Remove control appears (rate flow).
		 */
		reserveSummaryRemoveLayoutSlot?: boolean;
		showRatingStars?: boolean;
		/** Author and year share caption typography with a middle dot (shortlist detail). */
		inlineAuthorYearMeta?: boolean;
		showBookmarkAction: boolean;
		showNotInterestedAction: boolean;
		showReadItAction?: boolean;
		readItActive?: boolean;
		onReadItClick?: (e: MouseEvent) => void;
		bookmarked: boolean;
		onBookmarkClick: (e: MouseEvent) => void;
		onNotInterestedClick: (e: MouseEvent) => void;
		/** Mobile sheet: parent handles edge-swipe / drag-to-dismiss from scroll root. */
		onSummaryPointerDown?: (e: PointerEvent) => void;
		/** When bound, parents can read the scroll root (e.g. mobile drag-to-dismiss). */
		summaryContentEl?: HTMLElement | undefined;
		/** Shortlist detail: large cover beside a scrollable details column on desktop. */
		layout?: 'default' | 'shortlist-side-by-side';
		/** Shortlist detail: stars sit under the action row instead of in the details column. */
		ratingPlacement?: 'default' | 'below-actions';
		/** Shortlist: centered CTA when the book is marked not interested. */
		notInterestedOverlay?: 'replace' | 'new-rec' | null;
		onNotInterestedOverlayClick?: () => void;
		notInterestedOverlayBusy?: boolean;
	}

	let {
		book,
		summaryTitleId,
		displaySummary,
		showCoverImage,
		onCoverImageError,
		showAuthorInSheetMeta,
		showSearchAuthorInOverlay,
		onAuthorPillClick,
		notInterested,
		ratingGroupAriaLabel,
		displayRating,
		starAriaLabel,
		starAriaPressed,
		onStarMouseEnter,
		onStarClick,
		onRatingGroupMouseLeave,
		canRemoveRatingInSheet,
		onRemoveRatingClick,
		reserveSummaryRemoveLayoutSlot = false,
		showRatingStars = true,
		inlineAuthorYearMeta = false,
		showBookmarkAction,
		showNotInterestedAction,
		showReadItAction = false,
		readItActive = false,
		onReadItClick,
		bookmarked,
		onBookmarkClick,
		onNotInterestedClick,
		onSummaryPointerDown,
		summaryContentEl = $bindable(undefined),
		layout = 'default',
		ratingPlacement = 'default',
		notInterestedOverlay = null,
		onNotInterestedOverlayClick,
		notInterestedOverlayBusy = false
	}: Props = $props();

	const showSummaryRemoveSlot = $derived(canRemoveRatingInSheet || reserveSummaryRemoveLayoutSlot);
	const summaryRemoveLayoutOnly = $derived(reserveSummaryRemoveLayoutSlot && !canRemoveRatingInSheet);
	const labeledActionCount = $derived(
		[showBookmarkAction, showNotInterestedAction, showReadItAction].filter(Boolean).length
	);
	const isShortlistSideBySide = $derived(layout === 'shortlist-side-by-side');
	const showRatingBelowActions = $derived(
		showRatingStars && isShortlistSideBySide && ratingPlacement === 'below-actions'
	);
	const showRatingInDetails = $derived(showRatingStars && !showRatingBelowActions);
	const showNotInterestedOverlay = $derived(
		notInterested && notInterestedOverlay != null && onNotInterestedOverlayClick != null
	);
</script>

{#snippet summaryStarGlyph(filled: boolean)}
	<span class="book-card__star-icon" aria-hidden="true">
		<Star fill={filled ? 'currentColor' : 'none'} aria-hidden="true" />
	</span>
{/snippet}

{#snippet coverBlock()}
	<div class="book-card__summary-cover-wrap" aria-hidden="true">
		{#if showCoverImage}
			<img
				src={book.coverUrl}
				alt=""
				class="book-card__summary-cover"
				onerror={() => onCoverImageError?.()}
			/>
		{:else}
			<div class="book-card__summary-cover book-card__summary-cover--placeholder">
				{#if book.author || book.year}
					<span class="book-card__placeholder-author">
						{book.author}{#if book.year}<span class="book-card__year"> · {book.year}</span>{/if}
					</span>
				{/if}
				<span class="book-card__placeholder-title">{book.title}</span>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet headerTextBlock()}
	<div class="book-card__summary-header-text">
		<h3 class="book-card__summary-sheet-title typ-h3" id={summaryTitleId}>{book.title}</h3>

		{#if showAuthorInSheetMeta || book.year}
			<div
				class="book-card__summary-meta-row"
				class:book-card__summary-meta-row--inline-caption={inlineAuthorYearMeta}
			>
				{#if inlineAuthorYearMeta}
					{#if showAuthorInSheetMeta && book.year}
						<span class="book-card__summary-meta-inline typ-caption">
							{book.author} · {book.year}
						</span>
					{:else if showAuthorInSheetMeta}
						<span class="book-card__summary-meta-inline typ-caption">{book.author}</span>
					{:else if book.year}
						<span class="book-card__summary-meta-inline typ-caption">{book.year}</span>
					{/if}
				{:else}
					{#if showAuthorInSheetMeta}
						{#if showSearchAuthorInOverlay && onAuthorPillClick}
							<button
								type="button"
								class="book-card__summary-author-pill"
								aria-label={t('shared.bookCard.searchThisAuthorAriaLabel', { author: book.author })}
								onclick={onAuthorPillClick}
							>
								<Search size={14} aria-hidden="true" />
								<span>{book.author}</span>
							</button>
						{:else}
							<span class="book-card__summary-author-pill book-card__summary-author-pill--text">
								{book.author}
							</span>
						{/if}
					{/if}
					{#if book.year}
						<span class="book-card__summary-year typ-caption">{book.year}</span>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet ratingBlock(belowActions = false)}
	{#if (belowActions && showRatingBelowActions) || (!belowActions && showRatingInDetails)}
		<div
			class="book-card__rating-wrap book-card__rating-wrap--summary-sheet"
			class:book-card__rating-wrap--below-actions={belowActions}
		>
			<div
				class="book-card__rating"
				role="group"
				aria-label={ratingGroupAriaLabel}
				onmouseleave={onRatingGroupMouseLeave}
			>
				{#each RATING_OPTIONS as value}
					<button
						type="button"
						class="book-card__star"
						class:book-card__star--active={displayRating >= value}
						aria-label={starAriaLabel(value)}
						aria-pressed={starAriaPressed(value)}
						onmouseenter={() => onStarMouseEnter(value)}
						onclick={() => onStarClick(value)}
					>
						{@render summaryStarGlyph(displayRating >= value)}
					</button>
				{/each}
			</div>
			{#if showSummaryRemoveSlot}
				<button
					type="button"
					class="btn btn--tertiary btn--compact book-card__summary-remove-rating"
					class:book-card__summary-remove-rating--layout-only={summaryRemoveLayoutOnly}
					aria-hidden={summaryRemoveLayoutOnly ? true : undefined}
					aria-label={summaryRemoveLayoutOnly
						? undefined
						: t('shared.ratingsBar.removeRatingFor', { title: book.title })}
					tabindex={summaryRemoveLayoutOnly ? -1 : undefined}
					onclick={(e) => {
						if (!summaryRemoveLayoutOnly) onRemoveRatingClick(e);
					}}
				>
					<span class="btn__label">{t('shared.ratingsBar.remove')}</span>
				</button>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet summaryBodyBlock()}
	<div
		class="book-card__summary-muted"
		class:book-card__summary-muted--not-interested={notInterested}
	>
		{#if book.genres && book.genres.length > 0}
			<ul
				class="book-card__genres book-card__genres--summary-sheet"
				aria-label={t('shared.recommendationCard.genres')}
			>
				{#each book.genres as genre}
					<li class="book-card__genre">{genre}</li>
				{/each}
			</ul>
		{/if}

		<p class="book-card__summary">{displaySummary}</p>
	</div>
{/snippet}

{#snippet actionsBlock()}
	{#if showBookmarkAction || showNotInterestedAction || showReadItAction}
		<div
			class="book-card__summary-actions"
			class:book-card__summary-actions--single={labeledActionCount === 1}
		>
			{#if showBookmarkAction}
				<button
					type="button"
					class="book-card__action book-card__action--labeled"
					class:book-card__action--saved={bookmarked}
					aria-pressed={bookmarked}
					aria-label={bookmarked
						? t('shared.recommendationCard.removeFromReadingList')
						: t('shared.recommendationCard.addToReadingList')}
					onclick={onBookmarkClick}
				>
					<Bookmark size={14} aria-hidden="true" />
					<span class="book-card__action-label">
						{bookmarked ? t('shared.recommendationCard.saved') : t('shared.recommendationCard.bookmark')}
					</span>
				</button>
			{/if}
			{#if showReadItAction}
				<button
					type="button"
					class="book-card__action book-card__action--labeled"
					class:book-card__action--read-it-active={readItActive}
					aria-pressed={readItActive}
					aria-label={readItActive
						? t('recommendations.shortlist.removeIveReadIt')
						: t('recommendations.shortlist.iveReadIt')}
					onclick={(e) => onReadItClick?.(e)}
				>
					<Star size={14} aria-hidden="true" fill={readItActive ? 'currentColor' : 'none'} />
					<span class="book-card__action-label">{t('recommendations.shortlist.iveReadIt')}</span>
				</button>
			{/if}
			{#if showNotInterestedAction}
				<button
					type="button"
					class="book-card__action book-card__action--labeled"
					class:book-card__action--not-interested-active={notInterested}
					aria-pressed={notInterested}
					aria-label={notInterested
						? t('shared.recommendationCard.removeFromNotInterested')
						: t('shared.recommendationCard.notInterested')}
					onclick={onNotInterestedClick}
				>
					<ThumbsDown size={14} aria-hidden="true" />
					<span class="book-card__action-label">{t('shared.recommendationCard.notInterested')}</span>
				</button>
			{/if}
		</div>
	{/if}
{/snippet}

<div
	class="book-card__summary-content"
	class:book-card__summary-content--shortlist-side-by-side={isShortlistSideBySide}
	bind:this={summaryContentEl}
	onpointerdown={onSummaryPointerDown}
	role={onSummaryPointerDown ? 'region' : undefined}
	aria-labelledby={onSummaryPointerDown ? summaryTitleId : undefined}
>
	{#if isShortlistSideBySide}
		<div class="book-card__summary-shortlist-main">
			<div class="book-card__summary-side-layout">
				{#if showNotInterestedOverlay}
					<div class="book-card__summary-not-interested-overlay" aria-live="polite">
						<Button
							variant="primary"
							pill
							disabled={notInterestedOverlayBusy}
							aria-busy={notInterestedOverlayBusy ? 'true' : undefined}
							onclick={() => onNotInterestedOverlayClick?.()}
						>
							{notInterestedOverlay === 'replace'
								? t('recommendations.shortlist.offerAnotherBook')
								: t('recommendations.shortlist.getNewRecommendations')}
						</Button>
					</div>
				{/if}
				<div
					class="book-card__summary-cover-column"
					class:book-card__summary-muted--not-interested={notInterested}
				>
					{@render coverBlock()}
				</div>
				<div class="book-card__summary-details-column">
					<div class:book-card__summary-muted--not-interested={notInterested}>
						{@render headerTextBlock()}
					</div>
					{@render ratingBlock()}
					{@render summaryBodyBlock()}
				</div>
			</div>
			{@render actionsBlock()}
			{@render ratingBlock(true)}
		</div>
	{:else}
		<div
			class="book-card__summary-muted"
			class:book-card__summary-muted--not-interested={notInterested}
		>
			<div class="book-card__summary-header">
				{@render coverBlock()}
				{@render headerTextBlock()}
			</div>
		</div>

		{@render ratingBlock()}
		{@render summaryBodyBlock()}
		{@render actionsBlock()}
	{/if}
</div>
