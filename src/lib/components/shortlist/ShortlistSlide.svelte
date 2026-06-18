<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Book, RatingValue } from '$lib/types/book';
	import ShortlistBookDetail from './ShortlistBookDetail.svelte';
	import type { ShortlistMetaSection } from './shortlist-meta';

	interface Props {
		book: Book;
		index: number;
		scrollSlot: number;
		setSize: number;
		activeScrollSlot: number;
		reducedMotion: boolean;
		slideId: string;
		isClone?: boolean;
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
		onPrev?: () => void;
		onNext?: () => void;
	}

	let {
		book,
		index,
		scrollSlot,
		setSize,
		activeScrollSlot,
		reducedMotion,
		slideId,
		isClone = false,
		onPrev,
		onNext,
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

	const offset = $derived(scrollSlot - activeScrollSlot);
	const isActive = $derived(offset === 0);
	const isPeek = $derived(offset === 1 || offset === -1);
	const showNav = $derived(isActive && setSize > 1 && !isClone);
</script>

<div
	id={slideId}
	class="shortlist-slide"
	class:shortlist-slide--active={isActive}
	class:shortlist-slide--peek={isPeek && offset === 1}
	class:shortlist-slide--peek-prev={isPeek && offset === -1}
	class:shortlist-slide--reduced-motion={reducedMotion}
	role="group"
	aria-roledescription="slide"
	aria-hidden={!isActive ? true : undefined}
	style:--shortlist-slide-offset={offset}
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
