import { describe, expect, it } from 'vitest';
import { calculateContributionComposition } from './contribution-bar';
import { formatContribution } from './score';

const segments = (values: number[]) =>
	values.map((value, index) => ({
		feature: `feature-${index}`,
		label: `Feature ${index}`,
		value,
		colour: `colour-${index}`
	}));

describe('contribution bar composition', () => {
	it('normalises mixed-sign widths and places the zero divider correctly', () => {
		const composition = calculateContributionComposition(segments([-2, 1, 1]));

		expect(
			composition.segments.map(({ feature, width, sign }) => ({ feature, width, sign }))
		).toEqual([
			{ feature: 'feature-0', width: 50, sign: 'negative' },
			{ feature: 'feature-1', width: 25, sign: 'positive' },
			{ feature: 'feature-2', width: 25, sign: 'positive' }
		]);
		expect(composition.segments.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(100);
		expect(composition.zeroBoundary).toBe(50);
		expect(composition.hasNegative).toBe(true);
		expect(composition.hasPositive).toBe(true);
	});

	it('keeps zero-valued features available without giving them width', () => {
		const composition = calculateContributionComposition(segments([-3, 0, 3]));

		expect(
			composition.segments.map(({ feature, width, sign }) => ({ feature, width, sign }))
		).toEqual([
			{ feature: 'feature-0', width: 50, sign: 'negative' },
			{ feature: 'feature-1', width: 0, sign: 'zero' },
			{ feature: 'feature-2', width: 50, sign: 'positive' }
		]);
		expect(composition.zeroBoundary).toBe(50);
	});

	it('fills the complete bar for one-sided positive and negative values', () => {
		const positive = calculateContributionComposition(segments([1, 2, 3]));
		const negative = calculateContributionComposition(segments([-1, -2, -3]));

		expect(positive.segments.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(100);
		expect(positive.hasNegative).toBe(false);
		expect(positive.hasPositive).toBe(true);
		expect(negative.segments.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(100);
		expect(negative.hasNegative).toBe(true);
		expect(negative.hasPositive).toBe(false);
	});

	it('preserves feature order within each sign group and keeps signed formatting', () => {
		const composition = calculateContributionComposition(segments([1, -2, 3, -1]));

		expect(composition.segments.map((segment) => segment.feature)).toEqual([
			'feature-1',
			'feature-3',
			'feature-0',
			'feature-2'
		]);
		expect(formatContribution(0.8)).toBe('+0.80');
		expect(formatContribution(-0.8)).toBe('-0.80');
	});

	it('uses a neutral full-width fallback when every contribution is zero', () => {
		const composition = calculateContributionComposition(segments([0, 1e-12, -1e-12]));

		expect(composition.allZero).toBe(true);
		expect(composition.zeroBoundary).toBeNull();
		expect(composition.totalMagnitude).toBe(0);
		expect(composition.segments.every((segment) => segment.width === 0)).toBe(true);
	});
});
