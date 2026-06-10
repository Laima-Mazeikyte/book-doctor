<script lang="ts">
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import Button from '$lib/components/Button.svelte';
	import { prefersReducedMotion } from '$lib/navigation/mainNavTransition';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';
	import { activeIndexFromScroll, scrollLeftForIndex } from './carouselIndex';
	import ShortlistSlide from './ShortlistSlide.svelte';
	import type { ShortlistMetaSection } from './shortlist-meta';

	interface Props {
		books: Book[];
		getBookmarked: (bookId: string) => boolean;
		getNotInterested: (bookId: string) => boolean;
		getRating: (bookId: string) => RatingValue | null;
		onBookmark: (book: Book) => void;
		onNotInterested: (book: Book) => void;
		onRate: (book: Book, value: RatingValue) => void;
		onRemoveRating: (book: Book) => void;
		metaSections?: ShortlistMetaSection[];
		beforeMeta?: Snippet<[{ book: Book; index: number; setSize: number }]>;
		afterMeta?: Snippet<[{ book: Book; index: number; setSize: number }]>;
		footer?: Snippet<[{ book: Book; index: number; setSize: number }]>;
	}

	let {
		books,
		getBookmarked,
		getNotInterested,
		getRating,
		onBookmark,
		onNotInterested,
		onRate,
		onRemoveRating,
		metaSections,
		beforeMeta,
		afterMeta,
		footer
	}: Props = $props();

	let trackEl = $state<HTMLElement | null>(null);
	let activeIndex = $state(0);
	let reducedMotion = $state(false);

	const setSize = $derived(books.length);
	const canGoPrev = $derived(activeIndex > 0);
	const canGoNext = $derived(activeIndex < setSize - 1);
	const carouselId = 'shortlist-carousel-track';

	$effect(() => {
		if (!browser) return;
		reducedMotion = prefersReducedMotion();
	});

	function syncActiveIndex() {
		const el = trackEl;
		if (!el || setSize === 0) return;
		activeIndex = activeIndexFromScroll(el.scrollLeft, el.clientWidth, setSize);
	}

	function scrollToIndex(index: number, behavior: ScrollBehavior = 'smooth') {
		const el = trackEl;
		if (!el) return;
		const next = Math.max(0, Math.min(setSize - 1, index));
		el.scrollTo({ left: scrollLeftForIndex(next, el.clientWidth), behavior });
		activeIndex = next;
	}

	function goPrev() {
		if (!canGoPrev) return;
		scrollToIndex(activeIndex - 1);
	}

	function goNext() {
		if (!canGoNext) return;
		scrollToIndex(activeIndex + 1);
	}

	function handleTrackKeydown(e: KeyboardEvent) {
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

	function slideId(index: number): string {
		return `shortlist-slide-${index}`;
	}
</script>

<div class="shortlist-carousel">
	{#if setSize > 1}
		<div class="shortlist-carousel__nav shortlist-carousel__nav--prev">
			<Button
				variant="secondary"
				compact
				disabled={!canGoPrev}
				aria-label={t('recommendations.shortlist.prevBook')}
				aria-controls={carouselId}
				onclick={goPrev}
			>
				<ChevronLeft size={20} aria-hidden="true" />
			</Button>
		</div>
		<div class="shortlist-carousel__nav shortlist-carousel__nav--next">
			<Button
				variant="secondary"
				compact
				disabled={!canGoNext}
				aria-label={t('recommendations.shortlist.nextBook')}
				aria-controls={carouselId}
				onclick={goNext}
			>
				<ChevronRight size={20} aria-hidden="true" />
			</Button>
		</div>
	{/if}

	<section
		id={carouselId}
		class="shortlist-carousel__track"
		class:shortlist-carousel__track--reduced-motion={reducedMotion}
		bind:this={trackEl}
		aria-roledescription="carousel"
		aria-label={t('recommendations.shortlist.carouselAriaLabel')}
		tabindex="0"
		onscroll={syncActiveIndex}
		onkeydown={handleTrackKeydown}
	>
		{#each books as book, index (book.id)}
			<ShortlistSlide
				slideId={slideId(index)}
				{book}
				{index}
				{setSize}
				{activeIndex}
				{reducedMotion}
				bookmarked={getBookmarked(book.id)}
				notInterested={getNotInterested(book.book_id)}
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
	</section>
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
	.shortlist-carousel__nav {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		z-index: 5;
		display: none;
		pointer-events: none;
	}
	.shortlist-carousel__nav :global(.btn) {
		pointer-events: auto;
		box-shadow: var(--shadow-sm, 0 1px 3px color-mix(in srgb, var(--color-text) 12%, transparent));
	}
	.shortlist-carousel__nav--prev {
		left: var(--space-3);
	}
	.shortlist-carousel__nav--next {
		right: var(--space-3);
	}
	@media (min-width: 768px) {
		.shortlist-carousel__nav {
			display: block;
		}
	}
</style>
