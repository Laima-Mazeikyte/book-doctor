<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { X } from 'lucide-svelte';
	import SelectionCover from './SelectionCover.svelte';
	import { selectionStripLayout, STRIP_OVERLAP } from './selectionStripLayout';
	import { t } from '$lib/copy';
	import type { Book } from '$lib/types/book';

	let {
		books,
		dismissed,
		disabled = false,
		resetLayers = true,
		onRemove,
		onOpen
	}: {
		books: Book[];
		dismissed: Set<string>;
		disabled?: boolean;
		resetLayers?: boolean;
		onRemove: (id: string) => void;
		onOpen: (book: Book, trigger: HTMLElement) => void;
	} = $props();
	let strip = $state<HTMLDivElement>();
	let viewportWidth = $state(0);
	let baseHeight = $state(252);
	let ratios = $state<Record<string, number>>({});
	let stack = $state<string[]>([]);
	$effect(() => {
		void resetLayers;
		stack = [];
	});
	const layers = $derived(new Map(stack.map((id, index) => [id, index + 1])));
	const layout = $derived(
		selectionStripLayout(
			books.map((book) => ratios[book.book_id] ?? 2 / 3),
			viewportWidth,
			baseHeight
		)
	);
	const overflowing = $derived(layout.overflowing);
	let dragging = $state(false);
	let pointer: {
		id: number;
		startX: number;
		startY: number;
		lastX: number;
		mouse: boolean;
	} | null = null;
	let suppressClick = false;
	let cycleWidth = 0;
	let looping = false;
	let anchor: { id: string; index: number; offset: number } | null = null;

	function promote(id: string) {
		if (dragging || stack.at(-1) === id) return;
		const ids = new Set(books.map((book) => book.book_id));
		stack = [...stack.filter((value) => value !== id && ids.has(value)), id];
	}
	function recordRatio(id: string, ratio: number) {
		if (!Number.isFinite(ratio) || ratio <= 0 || ratios[id] === ratio) return;
		captureAnchor();
		ratios = { ...ratios, [id]: ratio };
	}
	function open(book: Book, event: MouseEvent) {
		if ((suppressClick && event.detail !== 0) || disabled) return;
		promote(book.book_id);
		onOpen(book, event.currentTarget as HTMLButtonElement);
	}
	function preventDragClick(event: MouseEvent) {
		if (!suppressClick || event.detail === 0) return;
		event.preventDefault();
		event.stopPropagation();
	}

	function captureAnchor() {
		if (!strip || !cycleWidth || anchor) return;
		const cards = strip.querySelectorAll<HTMLElement>('[data-copy="1"] .selected-book');
		const delta = strip.scrollLeft - (looping ? cycleWidth : 0);
		const local =
			Math.abs(delta) < 1 ? 0 : looping ? ((delta % cycleWidth) + cycleWidth) % cycleWidth : delta;
		const card = [...cards].findLast((card) => card.offsetLeft <= local) ?? cards[0];
		if (card)
			anchor = {
				id: card.dataset.bookId!,
				index: Number(card.dataset.index),
				offset: local - card.offsetLeft
			};
	}
	function restoreAnchor() {
		if (!strip) return;
		const middle = strip.querySelector<HTMLElement>('[data-copy="1"]');
		if (!middle) return;
		cycleWidth = middle.getBoundingClientRect().width;
		looping = layout.looping;
		const cards = middle.querySelectorAll<HTMLElement>('.selected-book');
		const card = anchor
			? ([...cards].find((card) => card.dataset.bookId === anchor!.id) ??
				cards[Math.min(anchor.index, books.length - 1)])
			: cards[0];
		const local = (card?.offsetLeft ?? 0) + (anchor?.offset ?? 0);
		strip.scrollTo({
			left: looping ? cycleWidth + local : overflowing ? local : 0,
			behavior: 'instant'
		});
		anchor = null;
		wrap();
	}
	// Only remeasure when the selection or viewport changes; scrolling never updates Svelte state.
	$effect.pre(() => {
		void books;
		void layout;
		void viewportWidth;
		untrack(captureAnchor);
	});
	$effect(() => {
		void books;
		void layout;
		void viewportWidth;
		void strip;
		untrack(restoreAnchor);
	});
	function observeWidth(element: HTMLDivElement) {
		const resize = () => {
			if (!element.getClientRects().length) return;
			const nextViewport = element.clientWidth;
			const nextHeight =
				element.querySelector<HTMLElement>('.cover-size')?.getBoundingClientRect().height ?? 252;
			if (nextViewport === viewportWidth && nextHeight === baseHeight) return;
			captureAnchor();
			viewportWidth = nextViewport;
			baseHeight = nextHeight;
		};
		const observer = new ResizeObserver(resize);
		observer.observe(element);
		return { destroy: () => observer.disconnect() };
	}
	function wrap() {
		if (!strip || !cycleWidth || !looping) return;
		const left = strip.scrollLeft;
		// Fractional cover widths can round scrollLeft by a pixel; avoid rebasing back and forth.
		if (left < cycleWidth - 1 || left >= cycleWidth * 2 + 1) {
			strip.scrollTo({
				left: cycleWidth + ((((left - cycleWidth) % cycleWidth) + cycleWidth) % cycleWidth),
				behavior: 'instant'
			});
		}
	}
	function keydown(event: KeyboardEvent) {
		if (event.target !== strip || !strip || !overflowing || !['Home', 'End'].includes(event.key))
			return;
		event.preventDefault();
		const index = event.key === 'Home' ? 0 : books.length - 1;
		const card = strip.querySelector<HTMLElement>(`[data-copy="1"] [data-index="${index}"]`);
		strip.scrollTo({
			left: (looping ? cycleWidth : 0) + (card?.offsetLeft ?? 0),
			behavior: 'instant'
		});
	}
	function pointerDown(event: PointerEvent) {
		suppressClick = false;
		if (!overflowing || event.button !== 0 || (event.target as Element).closest('.remove-book'))
			return;
		pointer = {
			id: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			lastX: event.clientX,
			mouse: event.pointerType === 'mouse'
		};
	}
	function pointerMove(event: PointerEvent) {
		if (!strip || pointer?.id !== event.pointerId) return;
		if (!dragging && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 5)
			return;
		suppressClick = true;
		if (!pointer.mouse) return;
		if (!dragging) strip.setPointerCapture(event.pointerId);
		dragging = true;
		event.preventDefault();
		strip.scrollLeft += pointer.lastX - event.clientX;
		pointer.lastX = event.clientX;
		wrap();
	}
	function pointerEnd(event: PointerEvent) {
		if (pointer?.id !== event.pointerId) return;
		pointer = null;
		dragging = false;
		if (strip?.hasPointerCapture(event.pointerId)) strip.releasePointerCapture(event.pointerId);
	}
	async function remove(id: string, index: number, event: MouseEvent) {
		if (disabled || (suppressClick && event.detail !== 0)) return;
		const restoreFocus = event.currentTarget === document.activeElement;
		captureAnchor();
		onRemove(id);
		await tick();
		if (restoreFocus) {
			const next = strip?.querySelector<HTMLButtonElement>(
				`[data-copy="1"] [data-index="${Math.min(index, books.length - 1)}"] .remove-book`
			);
			(next ?? strip)?.focus({ preventScroll: true });
		}
	}
</script>

<svelte:window onpointermove={pointerMove} onpointerup={pointerEnd} onpointercancel={pointerEnd} />

<div class="strip-frame" class:faded={overflowing}>
	<!-- Native keyboard-scrollable region. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class="cover-strip"
		class:scrollable={overflowing}
		class:looping={layout.looping}
		class:dragging
		style={`--selection-cover-height:${layout.height}px;--book-spacing:${-STRIP_OVERLAP}px`}
		bind:this={strip}
		use:observeWidth
		onscroll={wrap}
		onkeydown={keydown}
		onpointerdown={pointerDown}
		onlostpointercapture={pointerEnd}
		onclickcapture={preventDragClick}
		ondragstart={(event) => event.preventDefault()}
		role="region"
		aria-label="Selected books"
		tabindex={overflowing ? 0 : -1}
	>
		<span class="cover-size" aria-hidden="true"></span>
		<!-- A second trailing copy keeps native scroll limits beyond the wrap point
		     even when one cycle is only just wider than the usable viewport. -->
		{#each layout.looping ? [0, 1, 2, 3] : [1] as copy (copy)}
			<div class="cover-cycle" data-copy={copy} aria-hidden={copy !== 1 ? true : undefined}>
				{#each books as book, index (book.book_id)}
					{@const primary = copy === 1}
					<div
						class="selected-book"
						class:dismissed={dismissed.has(book.book_id)}
						data-book-id={book.book_id}
						data-index={index}
						aria-hidden={!primary ? true : undefined}
						style={`--turn:${[-4, 1, -2, 3, -1, 4, -3, 2][index % 8]}deg;--selection-cover-ratio:${ratios[book.book_id] ?? 2 / 3};--layer:${layers.get(book.book_id) ?? 0}`}
					>
						<button
							type="button"
							class="cover-hit"
							{disabled}
							tabindex={primary ? 0 : -1}
							aria-label={book.author?.trim()
								? t('shared.recommendationCard.seeSummaryCoverAriaLabelWithAuthor', {
										title: book.title,
										author: book.author
									})
								: t('shared.recommendationCard.seeSummaryCoverAriaLabelTitleOnly', {
										title: book.title
									})}
							onpointerenter={(event) => {
								if (event.pointerType !== 'touch') promote(book.book_id);
							}}
							onfocus={() => promote(book.book_id)}
							onpointerdown={(event) => {
								if (!primary) event.preventDefault();
							}}
							onclick={(event) => open(book, event)}
						>
							<SelectionCover
								{book}
								large
								eager={primary && index < 8}
								onRatio={(ratio) => recordRatio(book.book_id, ratio)}
							/>
						</button>
						<button
							type="button"
							class="remove-book"
							{disabled}
							aria-label={`Remove ${book.title}`}
							title={`Remove ${book.title}`}
							tabindex={primary ? 0 : -1}
							onpointerenter={(event) => {
								if (event.pointerType !== 'touch') promote(book.book_id);
							}}
							onfocus={() => promote(book.book_id)}
							onpointerdown={(event) => {
								suppressClick = false;
								if (!primary) event.preventDefault();
							}}
							onclick={(event) => void remove(book.book_id, index, event)}><X size={16} /></button
						>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.strip-frame {
		position: relative;
		isolation: isolate;
	}
	.strip-frame.faded::before,
	.strip-frame.faded::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		width: clamp(56px, 10vw, 128px);
		pointer-events: none;
		z-index: 1000;
	}
	.strip-frame.faded::before {
		left: 0;
		background: linear-gradient(to right, var(--color-bg), transparent);
	}
	.strip-frame.faded::after {
		right: 0;
		background: linear-gradient(to left, var(--color-bg), transparent);
	}
	.cover-size {
		position: absolute;
		height: clamp(168px, 17.25vw, 252px);
		width: 0;
		visibility: hidden;
		pointer-events: none;
	}
	.cover-strip {
		display: flex;
		align-items: center;
		box-sizing: border-box;
		height: calc(clamp(168px, 17.25vw, 252px) + 72px);
		overflow-x: hidden;
		overflow-y: hidden;
		padding: 36px 22px;
		scrollbar-width: none;
		overscroll-behavior-x: contain;
		overflow-anchor: none;
		min-height: 220px;
		border-radius: 8px;
		user-select: none;
		-webkit-user-select: none;
	}
	.cover-strip.scrollable {
		overflow-x: auto;
		cursor: grab;
	}
	.cover-strip.dragging {
		cursor: grabbing;
	}
	.cover-strip::-webkit-scrollbar {
		display: none;
	}
	.cover-cycle {
		display: flex;
		align-items: center;
		flex: 0 0 auto;
		position: relative;
	}
	.cover-strip:not(.looping) .cover-cycle {
		padding-right: 24px;
	}
	.selected-book {
		flex: 0 0 auto;
		position: relative;
		margin-right: var(--book-spacing);
	}
	.cover-hit {
		position: relative;
		z-index: var(--layer);
		display: block;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transform: rotate(var(--turn));
		transition: transform var(--duration-normal) var(--ease-default);
	}
	.selected-book.dismissed .cover-hit {
		opacity: 0.45;
	}
	.selected-book:has(:focus-visible) .cover-hit {
		transform: rotate(var(--turn)) scale(1.05);
	}
	.cover-hit:focus-visible,
	.remove-book:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 3px;
	}
	@media (hover: hover) and (pointer: fine) {
		.selected-book:hover .cover-hit {
			transform: rotate(var(--turn)) scale(1.05);
		}
	}
	.dragging .cover-hit {
		cursor: grabbing;
	}
	.remove-book {
		position: absolute;
		right: 5px;
		top: -8px;
		width: 30px;
		height: 30px;
		border: 1px solid var(--color-border-hover);
		border-radius: 50%;
		background: var(--color-bg);
		color: var(--color-text);
		display: grid;
		place-items: center;
		z-index: calc(1001 + var(--layer));
		cursor: pointer;
	}
	.remove-book:hover {
		background: var(--color-bg-hover);
	}
	@media (prefers-reduced-motion: reduce) {
		.cover-hit {
			transition: none;
		}
	}
</style>
