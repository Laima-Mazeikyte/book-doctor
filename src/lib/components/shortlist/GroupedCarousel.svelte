<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import { prefersReducedMotion } from '$lib/navigation/mainNavTransition';
	import BookCard from '$lib/components/BookCard.svelte';
	import ShortlistPositionIndicator from './ShortlistPositionIndicator.svelte';
	import type { HydratedFlavorGroup } from '$lib/recommendations/flavorGroups';
	import type { BookCardListProps } from '$lib/components/book-card/types';
	import {
		logicalIndexFromScrollSlot,
		scrollSlotForLogicalIndex,
		teleportTargetSlot
	} from './carouselIndex';
	let {
		groups,
		activeIndex = $bindable(0),
		bookProps
	}: {
		groups: HydratedFlavorGroup[];
		activeIndex?: number;
		bookProps: (
			book: HydratedFlavorGroup['books'][number],
			group: HydratedFlavorGroup
		) => Omit<BookCardListProps, 'book' | 'context'>;
	} = $props();
	let trackEl = $state<HTMLElement | null>(null);
	let activeScrollSlot = $state(1);
	let initializedForSize = $state(0);
	let scrollSyncRaf: number | null = null;

	const setSize = $derived(groups.length);
	const carouselId = 'shortlist-carousel-track';
	const reducedMotion = $derived(browser && prefersReducedMotion());
	onDestroy(() => {
		if (scrollSyncRaf != null) cancelAnimationFrame(scrollSyncRaf);
	});
	const loopEnabled = $derived(setSize > 1);
	function slideWidth() {
		return trackEl?.querySelector('.group-slide')?.getBoundingClientRect().width ?? 0;
	}
	function nearestSlot() {
		const width = slideWidth();
		return width
			? Math.max(0, Math.min(setSize + 1, Math.round((trackEl?.scrollLeft ?? 0) / width)))
			: 0;
	}

	function applyScrollState() {
		const el = trackEl;
		if (!el || setSize === 0) return;
		const slot = nearestSlot();
		activeScrollSlot = slot;
		activeIndex = logicalIndexFromScrollSlot(slot, setSize);
	}

	function syncFromScroll() {
		if (scrollSyncRaf != null) return;
		scrollSyncRaf = requestAnimationFrame(() => {
			scrollSyncRaf = null;
			applyScrollState();
		});
	}

	function teleportToSlot(slot: number) {
		const el = trackEl;
		if (!el) return;
		el.style.scrollSnapType = 'none';
		el.scrollLeft = slot * slideWidth();
		applyScrollState();
		requestAnimationFrame(() => {
			if (trackEl) trackEl.style.scrollSnapType = '';
		});
	}

	function handleScrollEnd() {
		if (scrollSyncRaf != null) {
			cancelAnimationFrame(scrollSyncRaf);
			scrollSyncRaf = null;
		}
		applyScrollState();
		const el = trackEl;
		if (!el || !loopEnabled) return;
		const slot = nearestSlot();
		const target = teleportTargetSlot(slot, setSize);
		if (target != null) {
			teleportToSlot(target);
		}
	}

	function scrollToSlot(slot: number, behavior: ScrollBehavior = 'smooth') {
		const el = trackEl;
		if (!el || setSize === 0) return;
		if (reducedMotion) behavior = 'auto';
		el.scrollTo({ left: slot * slideWidth(), behavior });
		if (behavior === 'auto') {
			applyScrollState();
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
	// Preserve the selected group when the viewport changes size.
	$effect(() => {
		const el = trackEl;
		if (!el) return;
		let width = el.clientWidth;
		const observer = new ResizeObserver(() => {
			if (el.clientWidth === width) return;
			width = el.clientWidth;
			teleportToSlot(scrollSlotForLogicalIndex(activeIndex, setSize));
		});
		observer.observe(el);
		return () => observer.disconnect();
	});
</script>

{#snippet slide(group: HydratedFlavorGroup, slot: number, clone = false)}
	<section
		class="group-slide"
		class:group-slide--active={slot === activeScrollSlot}
		aria-label={'[COPY: group-label:' + group.key + ']'}
		aria-roledescription="slide"
		aria-hidden={slot !== activeScrollSlot}
		inert={slot !== activeScrollSlot}
	>
		<div class="group-panel">
			<h1 class="typ-h3" data-copy-placeholder={'group-label:' + group.key}>
				[COPY: group-label:{group.key}]
			</h1>
			<div class="group-content">
				{#if group.books.length}
					<div
						class="group-books"
						class:group-books--overall={group.key === 'overall'}
						class:group-books--single={group.books.length === 1}
					>
						{#each group.books as book (book.book_id)}
							<div class="group-book">
								{#if clone}
									<div class="group-preview">
										{#if book.coverUrl}<img src={book.coverUrl} alt="" />{:else}<span
												>{book.title}</span
											>{/if}
									</div>
								{:else}
									<BookCard
										{book}
										context="recommendations"
										coverOnly
										{...bookProps(book, group)}
									/>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="group-empty" data-copy-placeholder="empty-group">[COPY: empty-group]</p>
				{/if}
			</div>
		</div>
	</section>
{/snippet}

<div class="group-carousel">
	<section
		id={carouselId}
		class="group-track"
		bind:this={trackEl}
		aria-roledescription="carousel"
		aria-label="[COPY: group-carousel-label]"
		onscroll={syncFromScroll}
		onscrollend={handleScrollEnd}
	>
		{#if loopEnabled}{@render slide(groups[setSize - 1], 0, true)}{/if}
		{#each groups as group, index (group.key)}{@render slide(
				group,
				loopEnabled ? index + 1 : 0
			)}{/each}
		{#if loopEnabled}{@render slide(groups[0], setSize + 1, true)}{/if}
	</section>
	{#if loopEnabled}
		<nav class="group-controls" aria-label="[COPY: group-navigation-label]">
			<button type="button" aria-label="[COPY: previous-group]" onclick={goPrev}
				><ChevronLeft size={18} /></button
			>
			<ShortlistPositionIndicator position={activeIndex + 1} total={setSize} grouped />
			<button type="button" aria-label="[COPY: next-group]" onclick={goNext}
				><ChevronRight size={18} /></button
			>
		</nav>
	{/if}
</div>

<style>
	.group-carousel {
		--group-slide-width: 85%;
		--group-cover-width: min(160px, calc((85vw - 120px) / 4));
		display: flex;
		flex-direction: column;
		flex: 0 1 auto;
		min-height: 0;
		height: min(820px, calc(100dvh - 110px));
		position: relative;
		width: 100%;
	}
	.group-track {
		display: flex;
		flex: 1;
		min-height: 0;
		width: 100%;
		position: relative;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
		scroll-padding-inline: calc((100% - var(--group-slide-width)) / 2);
	}
	.group-track::before,
	.group-track::after {
		content: '';
		flex: 0 0 calc((100% - var(--group-slide-width)) / 2);
	}
	.group-track::-webkit-scrollbar {
		display: none;
	}
	.group-slide {
		flex: 0 0 var(--group-slide-width);
		width: var(--group-slide-width);
		min-width: 0;
		height: 100%;
		box-sizing: border-box;
		padding: var(--space-2) var(--space-3);
		scroll-snap-align: center;
		scroll-snap-stop: always;
	}
	.group-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		padding: var(--space-6);
		border: 1px solid color-mix(in srgb, var(--color-border) 65%, transparent);
		border-radius: var(--radius-lg, 20px);
		background: var(--color-card-bg);
		box-shadow: 0 10px 28px rgb(0 0 0 / 14%);
		opacity: 0.5;
		transform: scale(0.98);
		transition:
			opacity 200ms ease,
			transform 200ms ease;
	}
	.group-slide--active .group-panel {
		opacity: 1;
		transform: scale(1);
	}
	.group-panel h1 {
		margin: 0;
		text-align: left;
		font-size: clamp(1.125rem, 2vw, 1.5rem);
		overflow-wrap: anywhere;
		flex-shrink: 0;
	}
	.group-content {
		display: grid;
		place-items: center;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-block: var(--space-4);
	}
	.group-books {
		display: grid;
		grid-template-columns: repeat(2, var(--group-cover-width));
		justify-content: center;
		gap: var(--space-4);
	}
	.group-books--overall {
		grid-template-columns: repeat(4, var(--group-cover-width));
	}
	.group-books--single {
		grid-template-columns: var(--group-cover-width);
	}
	.group-book {
		min-width: 0;
		border-radius: var(--radius-sm);
		box-shadow: 0 5px 14px rgb(0 0 0 / 22%);
		transition: transform 160ms ease;
	}
	.group-slide--active .group-book:hover,
	.group-slide--active .group-book:focus-within {
		transform: translateY(-3px);
	}
	.group-preview {
		display: grid;
		place-items: center;
		width: 100%;
		aspect-ratio: 2 / 3;
		overflow: hidden;
		background: var(--color-card-placeholder-bg);
		border-radius: var(--radius-sm);
	}
	.group-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.group-empty {
		margin: 0;
		color: var(--color-text-muted);
		text-align: center;
	}
	.group-controls {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-2) max(var(--space-3), env(safe-area-inset-bottom));
	}
	.group-controls button {
		display: grid;
		place-items: center;
		min-width: var(--min-tap);
		min-height: var(--min-tap);
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--color-floating-control-bg);
		color: var(--color-text);
		cursor: pointer;
	}
	.group-controls button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	@media (min-width: 1024px) {
		.group-carousel {
			--group-slide-width: min(68%, 1120px);
			--group-cover-width: min(190px, calc((68vw - 128px) / 4), calc((100dvh - 330px) / 3));
		}
	}

	@media (max-width: 767px) {
		.group-carousel {
			--group-cover-width: min(110px, calc((85vw - 112px) / 3));
		}
		.group-panel {
			padding: var(--space-4);
		}
		.group-books {
			gap: var(--space-3);
		}
		.group-books--overall {
			grid-template-columns: repeat(3, var(--group-cover-width));
		}
		.group-controls {
			gap: var(--space-2);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.group-panel,
		.group-book {
			transition: none;
		}
		.group-slide--active .group-book:hover,
		.group-slide--active .group-book:focus-within {
			transform: none;
		}
	}
</style>
