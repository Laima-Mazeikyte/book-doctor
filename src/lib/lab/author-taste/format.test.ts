import { describe, expect, it } from 'vitest';
import {
	directionColorWeight,
	excludesZero,
	formatInterval,
	formatPValue,
	formatPercentagePoints,
	formatQValue,
	formatRate,
	formatRelativeLikelihood,
	percentagePoints,
	qValueFromNegLog10,
	relativeDirectionColorWeight,
	relativeLikelihoodPercent
} from './format';

describe('formatPercentagePoints', () => {
	it('signs both directions with a typographic minus', () => {
		expect(formatPercentagePoints(14.43)).toBe('+14.4 points');
		expect(formatPercentagePoints(-0.58)).toBe('−0.6 points');
		expect(formatPercentagePoints(0)).toBe('+0.0 points');
		expect(formatPercentagePoints(null)).toBe('—');
	});
});

describe('formatInterval', () => {
	it('converts proportions to percentage points', () => {
		expect(formatInterval(0.1244, 0.1758)).toBe('12.4 to 17.6 points');
	});

	/* The point estimate and its interval sit side by side, so they must use the same glyph. */
	it('uses the same minus sign as the point estimate, not an ASCII hyphen', () => {
		const interval = formatInterval(-0.1758, -0.1244);
		expect(interval).toBe('−17.6 to −12.4 points');
		expect(interval).not.toContain('-');
	});

	it('handles an interval straddling zero', () => {
		expect(formatInterval(-0.02, 0.03)).toBe('−2.0 to 3.0 points');
		expect(formatInterval(null, 0.03)).toBe('—');
	});
});

describe('percentagePoints', () => {
	it('scales a stored proportion', () => {
		expect(
			percentagePoints({
				selected: true,
				selectionFoldCount: 5,
				rateDifference: 0.1443,
				ciLower: 0.1,
				ciUpper: 0.19,
				logOddsRatio: 0.6,
				evidenceScore: 0.4,
				negLog10Q: 5,
				likeRate: 0.6,
				baselineRate: 0.46
			})
		).toBeCloseTo(14.43, 5);
	});
});

describe('formatRate', () => {
	it('rounds to whole percent', () => {
		expect(formatRate(0.604)).toBe('60%');
		expect(formatRate(0)).toBe('0%');
	});
});

describe('relative likelihood', () => {
	it('calculates relative differences from the baseline rate', () => {
		expect(relativeLikelihoodPercent(0.87, 0.81)).toBeCloseTo(7.407, 3);
		expect(relativeLikelihoodPercent(0.54, 0.59)).toBeCloseTo(-8.475, 3);
		expect(relativeLikelihoodPercent(0, 0)).toBe(0);
		expect(relativeLikelihoodPercent(0.06, 0)).toBe(Number.POSITIVE_INFINITY);
		expect(relativeLikelihoodPercent(null, 0.5)).toBeNull();
	});

	it('formats a compact signed percentage and caps large positive values', () => {
		expect(formatRelativeLikelihood(7.407)).toBe('+7%');
		expect(formatRelativeLikelihood(-8.475)).toBe('−8%');
		expect(formatRelativeLikelihood(0)).toBe('0%');
		expect(formatRelativeLikelihood(100)).toBe('+100%');
		expect(formatRelativeLikelihood(100.1)).toBe('100%+');
		expect(formatRelativeLikelihood(Number.POSITIVE_INFINITY)).toBe('100%+');
		expect(formatRelativeLikelihood(null)).toBe('—');
	});

	it('maps selected relative effects onto a muted-to-saturated scale', () => {
		expect(relativeDirectionColorWeight(50, false)).toBeNull();
		expect(relativeDirectionColorWeight(null, true)).toBeNull();
		expect(relativeDirectionColorWeight(0, true)).toBe(45);
		expect(relativeDirectionColorWeight(-50, true)).toBeCloseTo(72.5, 5);
		expect(relativeDirectionColorWeight(100, true)).toBe(100);
		expect(relativeDirectionColorWeight(500, true)).toBe(100);
		expect(relativeDirectionColorWeight(Number.POSITIVE_INFINITY, true)).toBe(100);
	});
});

describe('q-values', () => {
	/* The artifact stores −log10(q) so strong evidence survives a float32 instead of hitting 0. */
	it('inverts the stored transform', () => {
		expect(qValueFromNegLog10(2)).toBeCloseTo(0.01, 10);
		expect(qValueFromNegLog10(1.6519)).toBeCloseTo(0.0223, 4);
	});

	it('formats across the usable range', () => {
		expect(formatQValue(1.6519)).toBe('0.022');
		expect(formatQValue(5)).toBe('1.0e-5');
		expect(formatQValue(0)).toBe('≈ 1');
		expect(formatQValue(400)).toBe('< 1e-300');
		expect(formatQValue(Number.NaN)).toBe('—');
	});
});

describe('formatPValue', () => {
	it('formats an on-demand probability without implying a corrected q-value', () => {
		expect(formatPValue(0.0184)).toBe('0.018');
		expect(formatPValue(0.00042)).toBe('4.2e-4');
		expect(formatPValue(0)).toBe('< 1e-300');
		expect(formatPValue(null)).toBe('—');
	});
});

describe('directionColorWeight', () => {
	it('keeps on-demand and unselected directions neutral', () => {
		expect(directionColorWeight(0.1, false)).toBeNull();
		expect(directionColorWeight(null, true)).toBeNull();
	});

	it('starts at five points and saturates at ten', () => {
		expect(directionColorWeight(0.0499, true)).toBeNull();
		expect(directionColorWeight(0.05, true)).toBe(45);
		expect(directionColorWeight(-0.075, true)).toBeCloseTo(72.5, 5);
		expect(directionColorWeight(0.1, true)).toBe(100);
		expect(directionColorWeight(0.25, true)).toBe(100);
	});
});

describe('excludesZero', () => {
	it('is true only when the whole interval sits on one side', () => {
		expect(excludesZero(0.12, 0.18)).toBe(true);
		expect(excludesZero(-0.18, -0.12)).toBe(true);
		expect(excludesZero(-0.02, 0.03)).toBe(false);
		expect(excludesZero(0, 0.03)).toBe(false);
	});
});
