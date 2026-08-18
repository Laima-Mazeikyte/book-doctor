import { describe, expect, it } from 'vitest';
import {
	RELEASE_MIN_RAW_VARIANCE,
	minimumSimplexRawVariance,
	validateLensWeights,
	validateReleaseSimplex
} from './simplex';
import { ProminenceFormatError, ProminenceScoringError } from './types';

describe('continuous lens simplex safety', () => {
	it('finds the interior minimum of a positive identity covariance', () => {
		const result = minimumSimplexRawVariance([
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1]
		]);
		expect(result?.weights).toEqual([1 / 3, 1 / 3, 1 / 3]);
		expect(result?.variance).toBeCloseTo(1 / 3);
	});

	it('selects an edge minimum when the unconstrained interior would leave the simplex', () => {
		const result = minimumSimplexRawVariance([
			[1, -0.8, 0.2],
			[-0.8, 1, 0.2],
			[0.2, 0.2, 1]
		]);
		expect(result?.activeIndices).toEqual([0, 1]);
		expect(result?.weights).toEqual([0.5, 0.5, 0]);
		expect(result?.variance).toBeCloseTo(0.1);
	});

	it('does not let a genuinely negative stationary point win', () => {
		const result = minimumSimplexRawVariance([
			[1, 0.6, -0.6],
			[0.6, 1, 0],
			[-0.6, 0, 1]
		]);
		expect(result?.activeIndices).not.toEqual([0, 1, 2]);
		expect(result?.weights.every((weight) => weight >= 0)).toBe(true);
	});

	it('clips a round-off negative active weight and renormalises the candidate', () => {
		const r = 0.50000000001;
		const result = minimumSimplexRawVariance([
			[1, r, -r],
			[r, 1, 0],
			[-r, 0, 1]
		]);
		expect(result).not.toBeNull();
		expect(result?.weights.every((weight) => weight >= 0)).toBe(true);
		expect(result?.weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
	});

	it('is invariant under an explicit feature-column reorder', () => {
		const original = minimumSimplexRawVariance([
			[1, 0.2, -0.1],
			[0.2, 1, 0.3],
			[-0.1, 0.3, 1]
		]);
		const reordered = minimumSimplexRawVariance([
			[1, 0.3, -0.1],
			[0.3, 1, 0.2],
			[-0.1, 0.2, 1]
		]);
		expect(reordered?.variance).toBeCloseTo(original?.variance ?? 0);
	});

	it('applies the runtime request boundary to unsafe lenses', () => {
		expect(() =>
			validateLensWeights(
				[0.5, 0.5, 0],
				[
					[1, -1, 0],
					[-1, 1, 0],
					[0, 0, 1]
				]
			)
		).toThrow(ProminenceScoringError);
	});

	it('uses a larger release margin than the runtime threshold', () => {
		const below = RELEASE_MIN_RAW_VARIANCE * 0.9;
		const at = RELEASE_MIN_RAW_VARIANCE;
		const above = RELEASE_MIN_RAW_VARIANCE * 1.1;
		expect(() =>
			validateReleaseSimplex(
				Array.from({ length: 3 }, (_, row) =>
					Array.from({ length: 3 }, (_, column) => (row === column ? below * 3 : 0))
				)
			)
		).toThrow(ProminenceFormatError);
		expect(() =>
			validateReleaseSimplex(
				Array.from({ length: 3 }, (_, row) =>
					Array.from({ length: 3 }, (_, column) => (row === column ? at * 3 : 0))
				)
			)
		).toThrow(ProminenceFormatError);
		expect(() =>
			validateReleaseSimplex(
				Array.from({ length: 3 }, (_, row) =>
					Array.from({ length: 3 }, (_, column) => (row === column ? above * 3 : 0))
				)
			)
		).not.toThrow();
	});
});
