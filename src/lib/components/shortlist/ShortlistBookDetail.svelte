<script lang="ts">
	import type { Snippet } from 'svelte';
	import BookSummarySheetBody from '$lib/components/book-card/BookSummarySheetBody.svelte';
	import { getBookDisplaySummary } from '$lib/components/book-card/summaryStub';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';
	import ShortlistBookMeta from './ShortlistBookMeta.svelte';
	import type { ShortlistMetaSection } from './shortlist-meta';

	interface Props {
		book: Book;
		index: number;
		setSize: number;
		bookmarked: boolean;
		notInterested: boolean;
		currentRating: RatingValue | null;
		onBookmark: () => void;
		onNotInterested: () => void;
		onRate: (value: RatingValue) => void;
		onRemoveRating: () => void;
		metaSections?: ShortlistMetaSection[];
		beforeMeta?: Snippet<[{ book: Book; index: number; setSize: number }]>;
		afterMeta?: Snippet<[{ book: Book; index: number; setSize: number }]>;
		footer?: Snippet<[{ book: Book; index: number; setSize: number }]>;
	}

	let {
		book,
		index,
		setSize,
		bookmarked,
		notInterested,
		currentRating,
		onBookmark,
		onNotInterested,
		onRate,
		onRemoveRating,
		metaSections,
		beforeMeta,
		afterMeta,
		footer
	}: Props = $props();

	let coverImageFailed = $state(false);
	let hoverRating = $state(0);

	const summaryTitleId = $derived(`shortlist-book-title-${book.id}`);
	const displaySummary = $derived(getBookDisplaySummary(book));
	const showCoverImage = $derived(Boolean(book.coverUrl) && !coverImageFailed);
	const showAuthorInSheetMeta = $derived(Boolean(book.author?.trim()));
	const displayRating = $derived(hoverRating > 0 ? hoverRating : (currentRating ?? 0));
	const canRemoveRating = $derived(currentRating != null);

	function starAriaLabel(value: RatingValue): string {
		return currentRating === value
			? t('shared.recommendationCard.rateOutOf5Clear', { value })
			: t('shared.recommendationCard.rateOutOf5', { value });
	}

	function starAriaPressed(value: RatingValue): boolean {
		return currentRating === value;
	}

	function handleStarClick(value: RatingValue) {
		hoverRating = 0;
		if (currentRating === value) {
			onRemoveRating();
		} else {
			onRate(value);
		}
	}

	function handleBookmarkClick(e: MouseEvent) {
		e.stopPropagation();
		onBookmark();
	}

	function handleNotInterestedClick(e: MouseEvent) {
		e.stopPropagation();
		onNotInterested();
	}

	function handleRemoveRatingClick(e: MouseEvent) {
		e.stopPropagation();
		onRemoveRating();
	}
</script>

<article
	class="shortlist-detail"
	aria-label={t('recommendations.shortlist.slideAriaLabel', {
		title: book.title,
		position: index + 1,
		total: setSize
	})}
	aria-setsize={setSize}
	aria-posinset={index + 1}
>
	<div class="shortlist-detail__inner">
		{#if beforeMeta}
			<div class="shortlist-detail__slot shortlist-detail__slot--before">
				{@render beforeMeta({ book, index, setSize })}
			</div>
		{/if}

		<div class="shortlist-detail__sheet">
			<BookSummarySheetBody
				{book}
				{summaryTitleId}
				{displaySummary}
				{showCoverImage}
				onCoverImageError={() => (coverImageFailed = true)}
				{showAuthorInSheetMeta}
				showSearchAuthorInOverlay={false}
				{notInterested}
				ratingGroupAriaLabel={t('shared.recommendationCard.rateThisBook')}
				{displayRating}
				{starAriaLabel}
				{starAriaPressed}
				onStarMouseEnter={(value) => (hoverRating = value)}
				onStarClick={handleStarClick}
				onRatingGroupMouseLeave={() => (hoverRating = 0)}
				canRemoveRatingInSheet={canRemoveRating}
				onRemoveRatingClick={handleRemoveRatingClick}
				showBookmarkAction={true}
				showNotInterestedAction={true}
				{bookmarked}
				onBookmarkClick={handleBookmarkClick}
				onNotInterestedClick={handleNotInterestedClick}
			/>
		</div>

		<div class="shortlist-detail__extensions">
			<ShortlistBookMeta {book} sections={metaSections} />
		</div>

		{#if afterMeta}
			<div class="shortlist-detail__slot shortlist-detail__slot--after">
				{@render afterMeta({ book, index, setSize })}
			</div>
		{/if}

		{#if footer}
			<div class="shortlist-detail__slot shortlist-detail__slot--footer">
				{@render footer({ book, index, setSize })}
			</div>
		{/if}
	</div>
</article>

<style>
	.shortlist-detail {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.shortlist-detail__inner {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		width: 100%;
		max-width: var(--content-width-narrow);
		margin: 0 auto;
	}
	.shortlist-detail__sheet {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.shortlist-detail__sheet :global(.book-card__summary-content) {
		flex: 1;
		min-height: 0;
		padding-top: var(--space-4);
		padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
	}
	.shortlist-detail__extensions {
		padding: 0 var(--space-6) var(--space-4);
	}
	.shortlist-detail__slot {
		padding: 0 var(--space-6);
	}
	.shortlist-detail__slot--footer {
		padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
	}
</style>
