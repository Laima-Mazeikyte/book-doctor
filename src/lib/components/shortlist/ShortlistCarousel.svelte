<script lang="ts">
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import { prefersReducedMotion } from '$lib/navigation/mainNavTransition';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';
	import {
		logicalIndexFromScrollSlot,
		scrollLeftForSlot,
		scrollSlotForLogicalIndex,
		scrollSlotFromScrollLeft,
		teleportTargetSlot
	} from './carouselIndex';
	import ShortlistCoverStrip from './ShortlistCoverStrip.svelte';
	import ShortlistSlide from './ShortlistSlide.svelte';
	import type { ShortlistMetaSection } from './shortlist-meta';
	import type { NotInterestedOverlay } from './shortlist-books';

	interface Props {
		books: Book[];
		activeIndex?: number;
		getBookmarked: (bookId: string) => boolean;
		getNotInterested: (bookId: string) => boolean;
		getNotInterestedOverlay: (bookId: string) => NotInterestedOverlay;
		getRating: (bookId: string) => RatingValue | null;
		onBookmark: (book: Book) => void;
		onNotInterested: (book: Book) => void;
		onOfferAnotherBook: (book: Book, index: number) => void;
		onRequestNewRecommendations: () => void | Promise<void>;
		requestingRecommendations?: boolean;
		onRate: (book: Book, value: RatingValue) => void;
		onRemoveRating: (book: Book) => void;
		metaSections?: ShortlistMetaSection[];
		beforeMeta?: Snippet<[{ book: Book; index: number; setSize: number }]>;
		afterMeta?: Snippet<[{ book: Book; index: number; setSize: number }]>;
		footer?: Snippet<[{ book: Book; index: number; setSize: number }]>;
		/** Called once so parents can imperatively scroll after inserting a slide. */
		registerScrollController?: (controller: { scrollToIndex: (index: number) => void }) => void;
	}

	let {
		books,
		activeIndex = $bindable(0),
		getBookmarked,
		getNotInterested,
		getNotInterestedOverlay,
		getRating,
		onBookmark,
		onNotInterested,
		onOfferAnotherBook,
		onRequestNewRecommendations,
		requestingRecommendations = false,
		onRate,
		onRemoveRating,
		metaSections,
		beforeMeta,
		afterMeta,
		footer,
		registerScrollController
	}: Props = $props();

	let trackEl = $state<HTMLElement | null>(null);
	let activeScrollSlot = $state(1);
	let initializedForSize = $state(0);

	const setSize = $derived(books.length);
	const carouselId = 'shortlist-carousel-track';
	const reducedMotion = $derived(browser && prefersReducedMotion());
	const loopEnabled = $derived(setSize > 1);

	function syncFromScroll() {
		const el = trackEl;
		if (!el || setSize === 0) return;
		const slot = scrollSlotFromScrollLeft(el.scrollLeft, el.clientWidth, setSize);
		activeScrollSlot = slot;
		activeIndex = logicalIndexFromScrollSlot(slot, setSize);
	}

	function teleportToSlot(slot: number) {
		const el = trackEl;
		if (!el) return;
		el.style.scrollSnapType = 'none';
		el.scrollLeft = scrollLeftForSlot(slot, el.clientWidth);
		activeScrollSlot = slot;
		activeIndex = logicalIndexFromScrollSlot(slot, setSize);
		requestAnimationFrame(() => {
			if (trackEl) trackEl.style.scrollSnapType = '';
		});
	}

	function handleScrollEnd() {
		const el = trackEl;
		if (!el || !loopEnabled) return;
		const slot = scrollSlotFromScrollLeft(el.scrollLeft, el.clientWidth, setSize);
		const target = teleportTargetSlot(slot, setSize);
		if (target != null) {
			teleportToSlot(target);
		} else {
			syncFromScroll();
		}
	}

	function scrollToSlot(slot: number, behavior: ScrollBehavior = 'smooth') {
		const el = trackEl;
		if (!el || setSize === 0) return;
		el.scrollTo({ left: scrollLeftForSlot(slot, el.clientWidth), behavior });
		if (behavior === 'auto') {
			activeScrollSlot = slot;
			activeIndex = logicalIndexFromScrollSlot(slot, setSize);
		}
	}

	function scrollToIndex(index: number, behavior: ScrollBehavior = 'smooth') {
		if (setSize === 0) return;
		const slot = scrollSlotForLogicalIndex(index, setSize);
		scrollToSlot(slot, behavior);
	}

	function goPrev() {
		if (setSize <= 1) return;
		if (reducedMotion) {
			const next = (activeIndex - 1 + setSize) % setSize;
			scrollToIndex(next, 'auto');
			return;
		}
		scrollToSlot(activeScrollSlot - 1);
	}

	function goNext() {
		if (setSize <= 1) return;
		if (reducedMotion) {
			const next = (activeIndex + 1) % setSize;
			scrollToIndex(next, 'auto');
			return;
		}
		scrollToSlot(activeScrollSlot + 1);
	}

	function handleTrackKeydown(e: KeyboardEvent) {
		const target = e.target;
		if (
			target instanceof HTMLElement &&
			target.closest('input, textarea, select, [contenteditable="true"]')
		) {
			return;
		}

		const page = trackEl?.closest('.shortlist-page');
		const active = document.activeElement;
		if (
			!page ||
			(active instanceof HTMLElement && active !== document.body && !page.contains(active))
		) {
			return;
		}

		if (e.key === 'ArrowLeft' || e.key === 'Home') {
			e.preventDefault();
			if (e.key === 'Home') scrollToIndex(0);
			else goPrev();
		} else if (e.key === 'ArrowRight' || e.key === 'End') {
			e.preventDefault();
			if (e.key === 'End') scrollToIndex(setSize - 1);
			else goNext();
		}
	}

	function overlayForBook(book: Book): NotInterestedOverlay {
		if (!getNotInterested(book.book_id)) return null;
		return getNotInterestedOverlay(book.book_id);
	}

	function slideId(index: number): string {
		return `shortlist-slide-${index}`;
	}

	function handleOverlayClick(book: Book, index: number, overlay: NotInterestedOverlay) {
		if (overlay === 'replace') {
			onOfferAnotherBook(book, index);
		} else if (overlay === 'new-rec') {
			void onRequestNewRecommendations();
		}
	}

	$effect(() => {
		registerScrollController?.({ scrollToIndex });
	});

	$effect(() => {
		const el = trackEl;
		const count = setSize;
		if (!el || count === 0) {
			initializedForSize = 0;
			return;
		}

		if (initializedForSize === count) return;

		if (initializedForSize === 0) {
			const startSlot = count > 1 ? 1 : 0;
			teleportToSlot(startSlot);
		}

		initializedForSize = count;
	});
</script>

<svelte:window onkeydown={handleTrackKeydown} />

<div class="shortlist-carousel">
	<section
		id={carouselId}
		class="shortlist-carousel__track"
		class:shortlist-carousel__track--reduced-motion={reducedMotion}
		bind:this={trackEl}
		aria-roledescription="carousel"
		aria-label={t('recommendations.shortlist.carouselAriaLabel')}
		tabindex="0"
		onscroll={syncFromScroll}
		onscrollend={handleScrollEnd}
	>
		{#if loopEnabled}
			{@const cloneStartBook = books[setSize - 1]}
			{@const cloneStartOverlay = overlayForBook(cloneStartBook)}
			<ShortlistSlide
				slideId="shortlist-slide-clone-start"
				book={cloneStartBook}
				index={setSize - 1}
				scrollSlot={0}
				{setSize}
				{activeScrollSlot}
				{reducedMotion}
				isClone={true}
				onPrev={goPrev}
				onNext={goNext}
				bookmarked={getBookmarked(cloneStartBook.id)}
				notInterested={getNotInterested(cloneStartBook.book_id)}
				notInterestedOverlay={cloneStartOverlay}
				onNotInterestedOverlayClick={() =>
					handleOverlayClick(cloneStartBook, setSize - 1, cloneStartOverlay)}
				{requestingRecommendations}
				currentRating={getRating(cloneStartBook.id)}
				onBookmark={() => onBookmark(cloneStartBook)}
				onNotInterested={() => onNotInterested(cloneStartBook)}
				onRate={(value) => onRate(cloneStartBook, value)}
				onRemoveRating={() => onRemoveRating(cloneStartBook)}
				{metaSections}
				{beforeMeta}
				{afterMeta}
				{footer}
			/>
		{/if}

		{#each books as book, index (book.id)}
			{@const bookOverlay = overlayForBook(book)}
			<ShortlistSlide
				slideId={slideId(index)}
				{book}
				{index}
				scrollSlot={loopEnabled ? index + 1 : 0}
				{setSize}
				{activeScrollSlot}
				{reducedMotion}
				onPrev={goPrev}
				onNext={goNext}
				bookmarked={getBookmarked(book.id)}
				notInterested={getNotInterested(book.book_id)}
				notInterestedOverlay={bookOverlay}
				onNotInterestedOverlayClick={() => handleOverlayClick(book, index, bookOverlay)}
				{requestingRecommendations}
				currentRating={getRating(book.id)}
				onBookmark={() => onBookmark(book)}
				onNotInterested={() => onNotInterested(book)}
				onRate={(value) => onRate(book, value)}
				onRemoveRating={() => onRemoveRating(book)}
				{metaSections}
				{beforeMeta}
				{afterMeta}
				{footer}
			/>
		{/each}

		{#if loopEnabled}
			{@const cloneEndBook = books[0]}
			{@const cloneEndOverlay = overlayForBook(cloneEndBook)}
			<ShortlistSlide
				slideId="shortlist-slide-clone-end"
				book={cloneEndBook}
				index={0}
				scrollSlot={setSize + 1}
				{setSize}
				{activeScrollSlot}
				{reducedMotion}
				isClone={true}
				onPrev={goPrev}
				onNext={goNext}
				bookmarked={getBookmarked(cloneEndBook.id)}
				notInterested={getNotInterested(cloneEndBook.book_id)}
				notInterestedOverlay={cloneEndOverlay}
				onNotInterestedOverlayClick={() => handleOverlayClick(cloneEndBook, 0, cloneEndOverlay)}
				{requestingRecommendations}
				currentRating={getRating(cloneEndBook.id)}
				onBookmark={() => onBookmark(cloneEndBook)}
				onNotInterested={() => onNotInterested(cloneEndBook)}
				onRate={(value) => onRate(cloneEndBook, value)}
				onRemoveRating={() => onRemoveRating(cloneEndBook)}
				{metaSections}
				{beforeMeta}
				{afterMeta}
				{footer}
			/>
		{/if}
	</section>

	{#if setSize > 1}
		<div class="shortlist-carousel__covers">
			<ShortlistCoverStrip
				{books}
				{activeIndex}
				{getNotInterested}
				onSelect={(index) => scrollToIndex(index)}
			/>
		</div>
	{/if}
</div>

<style>
	.shortlist-carousel {
		position: relative;
		flex: 1;
		min-height: 0;
		width: 100%;
		display: flex;
		flex-direction: column;
	}
	.shortlist-carousel__track {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		flex: 1;
		min-height: 0;
		width: 100%;
		overflow-x: auto;
		overflow-y: hidden;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}
	.shortlist-carousel__track::-webkit-scrollbar {
		display: none;
	}
	.shortlist-carousel__covers {
		display: none;
		flex-shrink: 0;
		overflow: visible;
	}
	@media (min-width: 768px) {
		.shortlist-carousel__covers {
			display: block;
		}
	}
</style>
