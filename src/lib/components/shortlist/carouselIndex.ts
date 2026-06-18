export const MOBILE_DECK_SLIDE_WIDTH_RATIO = 0.85;
export const MOBILE_DECK_PEEK_SCALE = 0.78;

export type CarouselLayout = 'full' | 'deck';

export function slideStride(viewportWidth: number, layout: CarouselLayout = 'full'): number {
	if (layout === 'deck') return viewportWidth * MOBILE_DECK_SLIDE_WIDTH_RATIO;
	return viewportWidth;
}

/** Continuous scroll position in slide units (fractional during swipe). */
export function scrollRatioFromScrollLeft(
	scrollLeft: number,
	viewportWidth: number,
	layout: CarouselLayout = 'full'
): number {
	if (viewportWidth <= 0) return 0;
	if (layout === 'deck') {
		const stride = slideStride(viewportWidth, layout);
		return scrollLeft / stride;
	}
	return scrollLeft / viewportWidth;
}

/** Index of the slide closest to the horizontal scroll center. */
export function activeIndexFromScroll(
	scrollLeft: number,
	viewportWidth: number,
	slideCount: number,
	layout: CarouselLayout = 'full'
): number {
	if (slideCount <= 0 || viewportWidth <= 0) return 0;
	if (layout === 'deck') {
		const ratio = scrollRatioFromScrollLeft(scrollLeft, viewportWidth, layout);
		const raw = Math.round(ratio);
		return Math.max(0, Math.min(slideCount - 1, raw));
	}
	const center = scrollLeft + viewportWidth / 2;
	const raw = Math.round(center / viewportWidth - 0.5);
	return Math.max(0, Math.min(slideCount - 1, raw));
}

export function scrollLeftForIndex(
	index: number,
	viewportWidth: number,
	layout: CarouselLayout = 'full'
): number {
	if (layout === 'deck') {
		const stride = slideStride(viewportWidth, layout);
		return Math.max(0, index) * stride;
	}
	return Math.max(0, index) * viewportWidth;
}

/** Total DOM slots when loop clones are enabled (last + items + first). */
export function loopSlideCount(setSize: number): number {
	if (setSize <= 1) return Math.max(setSize, 0);
	return setSize + 2;
}

/** Scroll slot for a logical book index in a loop carousel. */
export function scrollSlotForLogicalIndex(logicalIndex: number, setSize: number): number {
	if (setSize <= 1) return 0;
	return logicalIndex + 1;
}

/** Active scroll slot from scroll position. */
export function scrollSlotFromScrollLeft(
	scrollLeft: number,
	viewportWidth: number,
	setSize: number,
	layout: CarouselLayout = 'full'
): number {
	return activeIndexFromScroll(scrollLeft, viewportWidth, loopSlideCount(setSize), layout);
}

/** Logical book index for a scroll slot (ignoring clone positions). */
export function logicalIndexFromScrollSlot(slot: number, setSize: number): number {
	if (setSize <= 0) return 0;
	if (setSize === 1) return 0;
	if (slot === 0) return setSize - 1;
	if (slot === setSize + 1) return 0;
	return slot - 1;
}

/** When resting on a clone slot, return the matching real slot to teleport to. */
export function teleportTargetSlot(slot: number, setSize: number): number | null {
	if (setSize <= 1) return null;
	if (slot === 0) return setSize;
	if (slot === setSize + 1) return 1;
	return null;
}

export function scrollLeftForSlot(
	slot: number,
	viewportWidth: number,
	layout: CarouselLayout = 'full'
): number {
	return scrollLeftForIndex(slot, viewportWidth, layout);
}
