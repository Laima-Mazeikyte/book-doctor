import { describe, expect, it } from 'vitest';
import {
	evidenceStrength,
	excludesZero,
	formatInterval,
	formatPercentagePoints,
	formatQValue,
	formatRate,
	percentagePoints,
	qValueFromNegLog10
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

	it('tiers evidence on the stored scale', () => {
		expect(evidenceStrength(4)).toBe('strong');
		expect(evidenceStrength(3)).toBe('strong');
		expect(evidenceStrength(2.5)).toBe('moderate');
		expect(evidenceStrength(1.3)).toBe('weak');
		expect(evidenceStrength(Number.NaN)).toBe('weak');
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
