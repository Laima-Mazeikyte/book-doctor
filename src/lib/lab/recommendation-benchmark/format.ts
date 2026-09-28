/** 0.125 → "12.5%". */
export function formatPercent(share: number, digits = 1): string {
	return (share * 100).toFixed(digits) + '%';
}

/** [0.085, 0.17] → "8.5–17.0%". */
export function formatInterval([low, high]: [number, number], digits = 1): string {
	return (low * 100).toFixed(digits) + '–' + (high * 100).toFixed(digits) + '%';
}

/**
 * 95% Wilson score interval for `hits` out of `n`. Unlike a percentile bootstrap it stays
 * honest at the handful of hits this benchmark sees: it leans upward near zero instead of
 * being clipped symmetric. [0, 0] when there are no readers.
 */
export function wilsonInterval(hits: number, n: number, z = 1.959963984540054): [number, number] {
	if (n <= 0) return [0, 0];
	const p = hits / n;
	const z2 = z * z;
	const denominator = 1 + z2 / n;
	const centre = (p + z2 / (2 * n)) / denominator;
	const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
	return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Reported to three decimals, with a floor so tiny values do not read as exactly zero. */
export function formatPValue(p: number): string {
	if (p < 0.001) return '< 0.001';
	return '= ' + p.toFixed(3);
}

/** 'history_q3' → 3. */
export function groupNumber(group: string): number {
	const match = /(\d+)$/.exec(group);
	return match ? Number(match[1]) : 0;
}

/** Ratings in the source data are averages, so a value like 4.5 is possible. */
export function formatRating(rating: number): string {
	return Number.isInteger(rating) ? rating.toFixed(0) : rating.toFixed(1);
}
