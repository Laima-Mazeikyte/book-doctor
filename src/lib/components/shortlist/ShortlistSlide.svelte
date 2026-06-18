<script lang="ts">
	import type { Snippet } from 'svelte';
	import { MOBILE_DECK_PEEK_SCALE } from './carouselIndex';
	import type { Book, RatingValue } from '$lib/types/book';
	import ShortlistBookDetail from './ShortlistBookDetail.svelte';
	import type { ShortlistMetaSection } from './shortlist-meta';
	import type { NotInterestedOverlay } from './shortlist-books';

	const DECK_PEEK_SCALE = MOBILE_DECK_PEEK_SCALE;
	const DECK_PEEK_OPACITY = 0.62;
	const DECK_ACTIVE_OPACITY = 1;
	const DECK_SUMMARY_FADE_START = 0.32;
	const DECK_FOOTER_FADE_START = 0.68;

	interface Props {
		book: Book;
		index: number;
		scrollSlot: number;
		setSize: number;
		activeScrollSlot: number;
		scrollRatio?: number;
		deckLayout?: boolean;
		reducedMotion: boolean;
		slideId: string;
		isClone?: boolean;
		bookmarked: boolean;
		notInterested: boolean;
		notInterestedOverlay?: NotInterestedOverlay;
		onNotInterestedOverlayClick?: () => void;
		requestingRecommendations?: boolean;
		currentRating: RatingValue | null;
		onBookmark: () => void;
		onNotInterested: () => void;
		onRate: (value: RatingValue) => void;
		onRemoveRating: () => void;
		metaSections?: ShortlistMetaSection[];
		beforeMeta?: Snippet<[{ book: Book; index: number; setSize: number }]>;
		afterMeta?: Snippet<[{ book: Book; index: number; setSize: number }]>;
		footer?: Snippet<[{ book: Book; index: number; setSize: number }]>;
		onPrev?: () => void;
		onNext?: () => void;
	}

	let {
		book,
		index,
		scrollSlot,
		setSize,
		activeScrollSlot,
		scrollRatio = 0,
		deckLayout = false,
		reducedMotion,
		slideId,
		isClone = false,
		onPrev,
		onNext,
		bookmarked,
		notInterested,
		notInterestedOverlay = null,
		onNotInterestedOverlayClick,
		requestingRecommendations = false,
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

	const isMobileDeck = $derived(deckLayout && setSize > 1);

	const offset = $derived(scrollSlot - activeScrollSlot);
	const deckDelta = $derived(scrollRatio - scrollSlot);
	const deckAbsDelta = $derived(Math.abs(deckDelta));
	const deckBlend = $derived(Math.max(0, 1 - deckAbsDelta));
	const deckNear = $derived(deckAbsDelta <= 1.02);

	const isActive = $derived(isMobileDeck ? deckBlend > 0.55 : offset === 0);
	const isPeek = $derived(!isMobileDeck && (offset === 1 || offset === -1));
	const showNav = $derived(isActive && setSize > 1 && !isClone);

	const deckCoverScale = $derived(
		reducedMotion
			? deckBlend >= 0.5
				? 1
				: DECK_PEEK_SCALE
			: DECK_PEEK_SCALE + (1 - DECK_PEEK_SCALE) * deckBlend
	);
	const deckOpacity = $derived(
		!deckNear ? 0 : DECK_PEEK_OPACITY + (DECK_ACTIVE_OPACITY - DECK_PEEK_OPACITY) * deckBlend
	);
	const deckSummaryOpacity = $derived(
		Math.min(1, Math.max(0, (deckBlend - DECK_SUMMARY_FADE_START) / (1 - DECK_SUMMARY_FADE_START)))
	);
	const deckFooterOpacity = $derived(
		Math.min(1, Math.max(0, (deckBlend - DECK_FOOTER_FADE_START) / (1 - DECK_FOOTER_FADE_START)))
	);
	const deckZIndex = $derived(Math.round(deckBlend * 100));
	const deckInteractive = $derived(deckBlend > 0.55);
	const deckFooterInteractive = $derived(deckFooterOpacity > 0.5);
</script>

<div
	id={slideId}
	class="shortlist-slide"
	class:shortlist-slide--active={isActive}
	class:shortlist-slide--peek={isPeek && offset === 1}
	class:shortlist-slide--peek-prev={isPeek && offset === -1}
	class:shortlist-slide--mobile-deck={isMobileDeck}
	class:shortlist-slide--reduced-motion={reducedMotion}
	role="group"
	aria-roledescription="slide"
	aria-hidden={isMobileDeck ? deckBlend < 0.45 : !isActive ? true : undefined}
	style:--shortlist-slide-offset={offset}
	style:--deck-cover-scale={isMobileDeck ? deckCoverScale : undefined}
	style:--deck-summary-opacity={isMobileDeck ? deckSummaryOpacity : undefined}
	style:--deck-footer-opacity={isMobileDeck ? deckFooterOpacity : undefined}
	style:opacity={isMobileDeck ? deckOpacity : undefined}
	style:z-index={isMobileDeck ? deckZIndex : undefined}
	style:pointer-events={isMobileDeck ? (deckInteractive ? 'auto' : 'none') : undefined}
	style:--deck-footer-events={isMobileDeck ? (deckFooterInteractive ? 'auto' : 'none') : undefined}
>
	<ShortlistBookDetail
		{book}
		{index}
		{setSize}
		{showNav}
		{onPrev}
		{onNext}
		{bookmarked}
		{notInterested}
		{notInterestedOverlay}
		{onNotInterestedOverlayClick}
		{requestingRecommendations}
		{currentRating}
		{onBookmark}
		{onNotInterested}
		{onRate}
		{onRemoveRating}
		{metaSections}
		{beforeMeta}
		{afterMeta}
		{footer}
	/>
</div>

<style>
	.shortlist-slide {
		flex: 0 0 100%;
		width: 100%;
		height: 100%;
		min-height: 0;
		scroll-snap-align: center;
		scroll-snap-stop: always;
		transform: scale(0.92) translateX(0);
		opacity: 0.35;
		transition:
			transform 0.35s cubic-bezier(0.32, 0.72, 0, 1),
			opacity 0.35s ease;
		transform-origin: center center;
		pointer-events: none;
	}
	.shortlist-slide--active {
		transform: scale(1) translateX(0);
		opacity: 1;
		pointer-events: auto;
		z-index: 2;
	}
	.shortlist-slide--peek {
		transform: scale(0.94) translateX(6%);
		opacity: 0.65;
		z-index: 1;
	}
	.shortlist-slide--peek-prev {
		transform: scale(0.94) translateX(-6%);
		opacity: 0.65;
		z-index: 1;
	}
	.shortlist-slide--reduced-motion {
		transition: none;
		transform: none;
		opacity: 1;
	}
	.shortlist-slide--reduced-motion.shortlist-slide--active {
		transform: none;
	}
	.shortlist-slide--reduced-motion:not(.shortlist-slide--active) {
		opacity: 0.4;
	}
	@media (max-width: 767px) {
		.shortlist-slide--mobile-deck {
			flex: 0 0 85vw;
			width: 85vw;
			overflow: visible;
			transform: none;
			transition: none;
			scroll-snap-stop: normal;
		}
		.shortlist-slide--mobile-deck :global(.shortlist-detail) {
			overflow: visible;
		}
		.shortlist-slide--mobile-deck :global(.book-card__summary-cover-column) {
			transform: scale(var(--deck-cover-scale, 1));
			transform-origin: center top;
			transition: none;
			will-change: transform;
		}
		.shortlist-slide--mobile-deck :global(.book-card__summary-details-column),
		.shortlist-slide--mobile-deck :global(.book-card__summary-not-interested-overlay),
		.shortlist-slide--mobile-deck :global(.shortlist-detail__extensions),
		.shortlist-slide--mobile-deck :global(.shortlist-detail__slot) {
			opacity: var(--deck-summary-opacity, 0);
			pointer-events: none;
			transition: none;
		}
		.shortlist-slide--mobile-deck :global(.book-card__summary-shortlist-footer) {
			opacity: var(--deck-footer-opacity, 0);
			pointer-events: var(--deck-footer-events, none);
			transition: none;
		}
		.shortlist-slide--mobile-deck
			:global(.book-card__summary-shortlist-footer .book-card__summary-actions),
		.shortlist-slide--mobile-deck
			:global(.book-card__summary-shortlist-footer .book-card__rating-wrap--below-actions) {
			pointer-events: inherit;
		}
	}
	@media (min-width: 768px) {
		.shortlist-slide {
			transform: none;
			transition: opacity 0.2s ease;
		}
		.shortlist-slide--active,
		.shortlist-slide--peek,
		.shortlist-slide--peek-prev {
			transform: none;
		}
		.shortlist-slide--peek,
		.shortlist-slide--peek-prev {
			opacity: 0.35;
		}
	}
</style>
