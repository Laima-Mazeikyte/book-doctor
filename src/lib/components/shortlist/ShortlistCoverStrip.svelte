<script lang="ts">
	import { browser } from '$app/environment';
	import { prefersReducedMotion } from '$lib/navigation/mainNavTransition';
	import { t } from '$lib/copy';
	import type { Book } from '$lib/types/book';

	interface Props {
		books: Book[];
		activeIndex: number;
		getNotInterested: (bookId: string) => boolean;
		onSelect: (index: number) => void;
	}

	let { books, activeIndex, getNotInterested, onSelect }: Props = $props();

	let scrollEl = $state<HTMLElement | null>(null);
	let coverImageFailed = $state<Record<string, true>>({});
	let hoveredIndex = $state<number | null>(null);

	const setSize = $derived(books.length);
	const reducedMotion = $derived(browser && prefersReducedMotion());

	const COVER_BASE_SCALE = 0.926;
	const COVER_ACTIVE_SCALE = 1.28;
	const COVER_LENS_RADIUS = 2.4;
	const COVER_HOVER_EMPHASIS = 0.05;
	const COVER_PUSH_STRENGTH = 8;

	function isThumbVisible(container: HTMLElement, button: HTMLElement): boolean {
		const containerRect = container.getBoundingClientRect();
		const buttonRect = button.getBoundingClientRect();
		return buttonRect.left >= containerRect.left && buttonRect.right <= containerRect.right;
	}

	$effect(() => {
		const index = activeIndex;
		const container = scrollEl;
		if (!container || index < 0 || index >= setSize) return;
		const activeButton = container.querySelector<HTMLButtonElement>(
			`[data-cover-index="${index}"]`
		);
		if (!activeButton || isThumbVisible(container, activeButton)) return;
		activeButton.scrollIntoView({
			inline: 'center',
			block: 'nearest',
			behavior: reducedMotion ? 'auto' : 'smooth'
		});
	});

	function showCoverImage(book: Book): boolean {
		return Boolean(book.coverUrl) && !coverImageFailed[book.id];
	}

	function handleCoverError(bookId: string) {
		coverImageFailed = { ...coverImageFailed, [bookId]: true };
	}

	function coverAriaLabel(book: Book, index: number): string {
		return t('recommendations.shortlist.slideAriaLabel', {
			title: book.title,
			position: index + 1,
			total: setSize
		});
	}

	function baseCoverScale(isActive: boolean): number {
		return isActive ? COVER_ACTIVE_SCALE : COVER_BASE_SCALE;
	}

	function lensFalloff(distance: number): number {
		if (distance >= COVER_LENS_RADIUS) return 0;
		const t = 1 - distance / COVER_LENS_RADIUS;
		return t * t * (3 - 2 * t);
	}

	function layoutSlotScale(isActive: boolean): number {
		return baseCoverScale(isActive);
	}

	function coverScale(index: number, isActive: boolean): number {
		if (reducedMotion) return baseCoverScale(isActive);

		if (hoveredIndex === null) {
			return baseCoverScale(isActive);
		}

		const distance = Math.abs(index - hoveredIndex);
		const falloff = lensFalloff(distance);
		let scale = COVER_BASE_SCALE + (COVER_ACTIVE_SCALE - COVER_BASE_SCALE) * falloff;

		if (index === hoveredIndex) {
			scale += COVER_HOVER_EMPHASIS;
		}

		if (isActive) {
			scale = Math.max(scale, COVER_ACTIVE_SCALE);
		}

		return scale;
	}

	function coverTranslateX(index: number): number {
		if (hoveredIndex === null || reducedMotion) return 0;

		const signedDistance = index - hoveredIndex;
		if (signedDistance === 0) return 0;

		return Math.sign(signedDistance) * COVER_PUSH_STRENGTH * lensFalloff(Math.abs(signedDistance));
	}

	function coverVisualScale(index: number, isActive: boolean): number {
		if (hoveredIndex === null || reducedMotion) return 1;

		const slotScale = layoutSlotScale(isActive);
		return coverScale(index, isActive) / slotScale;
	}

	function coverTransform(index: number, isActive: boolean): string {
		const translateX = coverTranslateX(index);
		const scale = coverVisualScale(index, isActive);

		if (translateX === 0 && scale === 1) {
			return '';
		}

		return `transform: translateX(${translateX}px) scale(${scale});`;
	}

	function coverZIndex(index: number): number | undefined {
		if (reducedMotion) return undefined;

		if (hoveredIndex === index) return 3;
		if (hoveredIndex === null) {
			return index === activeIndex ? 2 : undefined;
		}

		const distance = Math.abs(index - hoveredIndex);
		if (distance < 1) return 2;
		if (distance < 2) return 1;
		return undefined;
	}

	function clearHover() {
		hoveredIndex = null;
	}
</script>

<nav class="shortlist-cover-strip" aria-label={t('recommendations.shortlist.coverNavAriaLabel')}>
	<div
		class="shortlist-cover-strip__scroll"
		class:shortlist-cover-strip__scroll--reduced-motion={reducedMotion}
		bind:this={scrollEl}
		onmouseleave={clearHover}
	>
		{#each books as book, index (book.id)}
			{@const isActive = index === activeIndex}
			{@const notInterested = getNotInterested(book.book_id)}
			<button
				type="button"
				class="shortlist-cover-strip__item"
				class:shortlist-cover-strip__item--active={isActive}
				class:shortlist-cover-strip__item--not-interested={notInterested}
				class:shortlist-cover-strip__item--hovered={hoveredIndex === index}
				style:--slot-scale={layoutSlotScale(isActive)}
				style:z-index={coverZIndex(index) ?? undefined}
				data-cover-index={index}
				aria-current={isActive ? 'true' : undefined}
				aria-label={coverAriaLabel(book, index)}
				onmouseenter={() => (hoveredIndex = index)}
				onclick={() => onSelect(index)}
			>
				<span
					class="shortlist-cover-strip__cover"
					style={coverTransform(index, isActive) || undefined}
					aria-hidden="true"
				>
					{#if showCoverImage(book)}
						<img
							src={book.coverUrl}
							alt=""
							class="shortlist-cover-strip__image"
							onerror={() => handleCoverError(book.id)}
						/>
					{:else}
						<span class="shortlist-cover-strip__placeholder">
							{#if book.author?.trim()}
								<span class="shortlist-cover-strip__placeholder-author">{book.author}</span>
							{/if}
							<span class="shortlist-cover-strip__placeholder-title">{book.title}</span>
						</span>
					{/if}
				</span>
			</button>
		{/each}
	</div>
</nav>

<style>
	.shortlist-cover-strip {
		width: 100%;
		flex-shrink: 0;
		overflow: visible;
		--shortlist-cover-height: 4.5rem;
		--shortlist-cover-width: calc(var(--shortlist-cover-height) * 2 / 3);
		--shortlist-cover-active-scale: 1.28;
		--shortlist-cover-gap: var(--space-5);
		--shortlist-cover-motion-duration: 420ms;
		--shortlist-cover-motion-ease: cubic-bezier(0.23, 1, 0.32, 1);
		--shortlist-cover-strip-height: calc(
			var(--space-3) + var(--space-4) + var(--shortlist-cover-height) *
				var(--shortlist-cover-active-scale) + var(--space-4) +
				env(safe-area-inset-bottom, 0px)
		);
		height: var(--shortlist-cover-strip-height);
		padding: var(--space-3) var(--space-4)
			calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
		box-sizing: border-box;
	}
	.shortlist-cover-strip__scroll {
		display: flex;
		justify-content: center;
		align-items: flex-end;
		gap: var(--space-4);
		overflow-x: auto;
		overflow-y: visible;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
		padding-block: var(--space-2);
		padding-inline: var(--space-2);
		height: calc(var(--shortlist-cover-height) * var(--shortlist-cover-active-scale) + var(--space-4));
		box-sizing: border-box;
	}
	.shortlist-cover-strip__scroll::-webkit-scrollbar {
		display: none;
	}
	.shortlist-cover-strip__item {
		flex: 0 0 auto;
		position: relative;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		width: calc(var(--shortlist-cover-width) * var(--slot-scale, 0.926));
		height: calc(var(--shortlist-cover-height) * var(--slot-scale, 0.926));
		padding: 0;
		margin: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: var(--radius-sm);
		opacity: 1;
		overflow: visible;
		transition:
			width var(--shortlist-cover-motion-duration) var(--shortlist-cover-motion-ease),
			height var(--shortlist-cover-motion-duration) var(--shortlist-cover-motion-ease),
			opacity 0.2s ease;
	}
	.shortlist-cover-strip__item--not-interested {
		opacity: 0.18;
	}
	.shortlist-cover-strip__item--active.shortlist-cover-strip__item--not-interested {
		opacity: 0.28;
	}
	.shortlist-cover-strip__item--not-interested:hover:not(.shortlist-cover-strip__item--active) {
		opacity: 0.24;
	}
	.shortlist-cover-strip__item--hovered {
		z-index: 3;
	}
	.shortlist-cover-strip__item:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.shortlist-cover-strip__cover {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--color-card-placeholder-bg);
		border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
		box-sizing: border-box;
		transform-origin: bottom center;
		transition: transform var(--shortlist-cover-motion-duration) var(--shortlist-cover-motion-ease);
	}
	.shortlist-cover-strip__image {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center center;
	}
	.shortlist-cover-strip__placeholder {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: var(--space-1);
		width: 100%;
		height: 100%;
		padding: var(--space-1);
		box-sizing: border-box;
		text-align: left;
		background: var(--color-card-placeholder-bg);
	}
	.shortlist-cover-strip__placeholder-author,
	.shortlist-cover-strip__placeholder-title {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		font-size: 0.5rem;
		line-height: var(--line-height-tight);
	}
	.shortlist-cover-strip__placeholder-author {
		color: var(--color-text-muted);
	}
	.shortlist-cover-strip__placeholder-title {
		color: var(--color-book-title);
		font-weight: var(--font-weight-semibold);
	}
	.shortlist-cover-strip__scroll--reduced-motion .shortlist-cover-strip__item,
	.shortlist-cover-strip__scroll--reduced-motion .shortlist-cover-strip__cover {
		transition: none;
	}
</style>
