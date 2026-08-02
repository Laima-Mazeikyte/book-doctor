import type { DirectionEstimate } from './types';

/**
 * Presentation helpers.
 *
 * Everything here is formatting or a display-tier lookup. No estimate, interval or
 * threshold is recomputed — the artifact's numbers are final, and re-deriving any of them
 * would risk disagreeing with the `directionality_status` that was computed alongside them.
 */

/** Percentage points, from a stored proportion. */
export function percentagePoints(estimate: DirectionEstimate): number {
	return estimate.rateDifference * 100;
}

/** `toFixed` emits an ASCII hyphen; everything user-facing uses a real minus sign. */
function signed(value: number, decimals: number): string {
	return `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(decimals)}`;
}

export function formatPercentagePoints(value: number | null, decimals = 1): string {
	if (value === null || !Number.isFinite(value)) return '—';
	return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(decimals)} points`;
}

export function formatRate(rate: number | null): string {
	if (rate === null || !Number.isFinite(rate)) return '—';
	return `${Math.round(rate * 100)}%`;
}

/** Interval on the rate-difference scale, in percentage points. */
export function formatInterval(lower: number | null, upper: number | null, decimals = 1): string {
	if (lower === null || upper === null || !Number.isFinite(lower) || !Number.isFinite(upper)) {
		return '—';
	}
	return `${signed(lower * 100, decimals)} to ${signed(upper * 100, decimals)} points`;
}

/**
 * The artifact stores −log10(q) rather than q, which keeps very strong evidence
 * representable in a float32 instead of collapsing to zero.
 */
export function qValueFromNegLog10(negLog10Q: number): number {
	if (!Number.isFinite(negLog10Q)) return NaN;
	return Math.pow(10, -negLog10Q);
}

export function formatQValue(negLog10Q: number | null): string {
	if (negLog10Q === null || !Number.isFinite(negLog10Q)) return '—';
	if (negLog10Q <= 0) return '≈ 1';
	if (negLog10Q > 300) return '< 1e-300';
	const q = qValueFromNegLog10(negLog10Q);
	return q < 0.001 ? q.toExponential(1) : q.toFixed(3);
}

export type EvidenceStrength = 'strong' | 'moderate' | 'weak';

/** Tiers match the retired release's wording so the vocabulary stays stable for readers. */
export function evidenceStrength(negLog10Q: number | null): EvidenceStrength {
	if (negLog10Q === null || !Number.isFinite(negLog10Q)) return 'weak';
	if (negLog10Q >= 3) return 'strong';
	if (negLog10Q >= 2) return 'moderate';
	return 'weak';
}

/** True when a 95% interval sits entirely on one side of zero. */
export function excludesZero(lower: number, upper: number): boolean {
	return lower > 0 || upper < 0;
}
