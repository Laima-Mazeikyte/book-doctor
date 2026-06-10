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
