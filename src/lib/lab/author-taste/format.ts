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

export const RELATIVE_LIKELIHOOD_CAP = 100;

/** Relative difference from the comparison group's rate, expressed as a percentage. */
export function relativeLikelihoodPercent(
	likeRate: number | null,
	baselineRate: number | null
): number | null {
	if (
		likeRate === null ||
		baselineRate === null ||
		!Number.isFinite(likeRate) ||
		!Number.isFinite(baselineRate) ||
		likeRate < 0 ||
		baselineRate < 0
	) {
		return null;
	}
	if (baselineRate === 0) return likeRate === 0 ? 0 : Number.POSITIVE_INFINITY;
	return ((likeRate - baselineRate) / baselineRate) * 100;
}

/** Compact table form. Positive values beyond the useful display range invite inspection. */
export function formatRelativeLikelihood(relativePercent: number | null): string {
	if (relativePercent === null || Number.isNaN(relativePercent)) return '—';
	if (relativePercent === Number.POSITIVE_INFINITY || relativePercent > RELATIVE_LIKELIHOOD_CAP) {
		return `${RELATIVE_LIKELIHOOD_CAP}%+`;
	}
	if (!Number.isFinite(relativePercent)) return '—';
	const rounded = Math.round(Math.abs(relativePercent));
	if (rounded === 0) return '0%';
	return `${relativePercent > 0 ? '+' : '−'}${rounded}%`;
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

export function formatPValue(pValue: number | null): string {
	if (pValue === null || !Number.isFinite(pValue)) return '—';
	if (pValue <= 0) return '< 1e-300';
	return pValue < 0.001 ? pValue.toExponential(1) : pValue.toFixed(3);
}

export const DIRECTION_COLOR_MIN_POINTS = 5;
export const DIRECTION_COLOR_MAX_POINTS = 10;
export const DIRECTION_COLOR_MIN_WEIGHT = 45;

/**
 * Table colour follows the relative percentage displayed in the cell. Release selection is
 * still the gate; once selected, the hue starts muted and reaches full strength at 100%.
 */
export function relativeDirectionColorWeight(
	relativePercent: number | null,
	releaseSelected: boolean
): number | null {
	if (!releaseSelected || relativePercent === null || Number.isNaN(relativePercent)) return null;
	if (!Number.isFinite(relativePercent)) {
		return relativePercent === Number.POSITIVE_INFINITY ? 100 : null;
	}
	const progress = Math.min(1, Math.abs(relativePercent) / RELATIVE_LIKELIHOOD_CAP);
	return DIRECTION_COLOR_MIN_WEIGHT + progress * (100 - DIRECTION_COLOR_MIN_WEIGHT);
}

/**
 * Colour is reserved for directions selected by the release. Within that checked set, the
 * signed hue carries direction while its weight carries practical size: muted at five
 * percentage points and fully saturated at ten. On-demand and unselected estimates return
 * `null` and remain neutral regardless of their observed difference.
 */
export function directionColorWeight(
	rateDifference: number | null,
	releaseSelected: boolean
): number | null {
	if (!releaseSelected || rateDifference === null || !Number.isFinite(rateDifference)) return null;
	const points = Math.abs(rateDifference) * 100;
	if (points < DIRECTION_COLOR_MIN_POINTS) return null;
	const progress = Math.min(
		1,
		(points - DIRECTION_COLOR_MIN_POINTS) /
			(DIRECTION_COLOR_MAX_POINTS - DIRECTION_COLOR_MIN_POINTS)
	);
	return DIRECTION_COLOR_MIN_WEIGHT + progress * (100 - DIRECTION_COLOR_MIN_WEIGHT);
}

/** True when a 95% interval sits entirely on one side of zero. */
export function excludesZero(lower: number, upper: number): boolean {
	return lower > 0 || upper < 0;
}
