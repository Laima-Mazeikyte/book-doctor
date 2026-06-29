/** Cover-image loading tier for a card at a given grid position. */
export type CoverPriority = 'high' | 'eager' | 'lazy';

/** Grid rows treated as the "first viewport" and eager-loaded. */
const EAGER_ROWS = 2;

/**
 * Loading tier for the cover at `index` given the grid's column count.
 * Row 1 is the LCP candidate (`high`); the remaining eager rows are `eager`
 * (not deferred, but not flooding the high-priority lane); the rest are `lazy`.
 */
export function coverPriorityFor(index: number, columns: number): CoverPriority {
	const cols = columns > 0 ? columns : 2;
	if (index < cols) return 'high';
	if (index < cols * EAGER_ROWS) return 'eager';
	return 'lazy';
}

/**
 * Synchronous first-paint estimate of grid columns from viewport width, used
 * before the grid element can be measured. Divides by the largest column
 * min-width (240px) so it under- rather than over-estimates — fewer wasted
 * eager loads, and {@link trackGridColumns} corrects upward once mounted.
 * Falls back to the mobile minimum of 2 (and during SSR).
 */
export function estimateGridColumns(): number {
	if (typeof window === 'undefined') return 2;
	return Math.max(2, Math.floor(window.innerWidth / 240));
}

/**
 * Svelte action for a `.book-card-grid` element: reports the actual rendered
 * column count by counting the resolved `grid-template-columns` tracks. This is
 * robust across the fixed-2 mobile rule, the auto-fill breakpoints, and any
 * future CSS change. Re-measures on resize, emitting only when the count changes
 * (so resizes don't needlessly re-render the whole grid).
 */
export function trackGridColumns(
	node: HTMLElement,
	onChange: (columns: number) => void
): { destroy(): void } {
	let last = -1;
	const measure = () => {
		const tracks = getComputedStyle(node).gridTemplateColumns;
		const columns =
			tracks && tracks !== 'none' ? tracks.split(/\s+/).filter(Boolean).length : 0;
		if (columns > 0 && columns !== last) {
			last = columns;
			onChange(columns);
		}
	};
	measure();
	const observer = new ResizeObserver(measure);
	observer.observe(node);
	return {
		destroy() {
			observer.disconnect();
		}
	};
}
