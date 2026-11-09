export const STRIP_OVERLAP = 24;
export const STRIP_PADDING = 22;

/** Keep complete, differently proportioned jackets overlapping, including at loop seams. */
export function selectionStripLayout(ratios: number[], viewport: number, baseHeight: number) {
	const totalRatio = ratios.reduce((sum, ratio) => sum + ratio, 0);
	const fittedWidth = totalRatio * baseHeight - STRIP_OVERLAP * (ratios.length - 1);
	const available = Math.max(1, viewport - STRIP_PADDING * 2);
	const overflowing = ratios.length > 1 && viewport > 0 && fittedWidth > available + 1;
	if (!overflowing) {
		return {
			overflowing,
			looping: false,
			height: ratios.length === 1 ? Math.min(baseHeight, available / totalRatio) : baseHeight
		};
	}
	// Overflow always loops. At the threshold, a jacket may wrap across both faded
	// edges; never disable wrapping or enlarge covers to hide that partial repeat.
	return { overflowing, looping: true, height: baseHeight };
}
