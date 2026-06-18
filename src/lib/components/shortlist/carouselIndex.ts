/** Index of the slide closest to the horizontal scroll center. */
export function activeIndexFromScroll(
	scrollLeft: number,
	viewportWidth: number,
	slideCount: number
): number {
	if (slideCount <= 0 || viewportWidth <= 0) return 0;
	const center = scrollLeft + viewportWidth / 2;
	const raw = Math.round(center / viewportWidth - 0.5);
	return Math.max(0, Math.min(slideCount - 1, raw));
}

export function scrollLeftForIndex(index: number, viewportWidth: number): number {
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
	setSize: number
): number {
	return activeIndexFromScroll(scrollLeft, viewportWidth, loopSlideCount(setSize));
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

export function scrollLeftForSlot(slot: number, viewportWidth: number): number {
	return scrollLeftForIndex(slot, viewportWidth);
}
