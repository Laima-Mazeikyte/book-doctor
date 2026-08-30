import { describe, expect, it } from 'vitest';
import {
	adjustLensForArrow,
	adjustLensForArrowAt,
	changeOneShare,
	largestRemainderShares,
	lensState
} from './lens';
import type { ProminenceManifest } from './types';

describe('author prominence lens state math', () => {
	it('preserves the old ratio when one percentage changes', () => {
		const next = changeOneShare([0.35, 0.35, 0.3], 0, 70);
		expect(next[0]).toBe(0.7);
		expect(next[1]).toBeCloseTo(0.3 * (35 / 65));
		expect(next[2]).toBeCloseTo(0.3 * (30 / 65));
		expect(next.reduce((sum, value) => sum + value, 0)).toBe(1);
		expect(largestRemainderShares(next, 0)).toEqual([70, 16, 14]);
	});

	it('splits the remainder evenly when the other shares are zero', () => {
		const next = changeOneShare([1, 0, 0], 0, 25);
		expect(next).toEqual([0.25, 0.375, 0.375]);
		expect(largestRemainderShares(next, 0)).toEqual([25, 38, 37]);
	});

	it('uses the manipulated feature to resolve a display tie', () => {
		expect(largestRemainderShares([1 / 3, 1 / 3, 1 / 3], 2)).toEqual([33, 33, 34]);
		expect(largestRemainderShares([1 / 3, 1 / 3, 1 / 3])).toEqual([34, 33, 33]);
	});

	it('maps arrow adjustments to the intended feature and preserves the simplex', () => {
		const starting = [0.35, 0.35, 0.3];
		const cases = [
			['ArrowUp', 0, 0.36],
			['ArrowDown', 0, 0.34],
			['ArrowLeft', 1, 0.36],
			['ArrowRight', 2, 0.31]
		] as const;

		for (const [key, changedIndex, expected] of cases) {
			const next = adjustLensForArrow(starting, key);
			expect(next).not.toBeNull();
			if (!next) continue;
			expect(next[changedIndex]).toBeCloseTo(expected);
			expect(next.every((value) => value >= 0 && value <= 1)).toBe(true);
			expect(next.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
		}
	});

	it('supports five-point keyboard steps and stable boundary presses', () => {
		const shifted = adjustLensForArrow([0.35, 0.35, 0.3], 'ArrowLeft', 5);
		expect(shifted?.[1]).toBeCloseTo(0.4);
		expect(adjustLensForArrow([1, 0, 0], 'ArrowUp')).toEqual([1, 0, 0]);
		expect(adjustLensForArrow([0, 0.4, 0.6], 'ArrowDown')).toEqual([0, 0.4, 0.6]);
		expect(adjustLensForArrow([0.35, 0.35, 0.3], 'PageDown')).toBeNull();
	});

	it('resolves keyboard directions by feature name when release order changes', () => {
		const next = adjustLensForArrowAt([0.35, 0.35, 0.3], 'ArrowUp', 1, {
			regard: 1,
			reach: 2,
			recognition: 0
		});
		expect(next?.[1]).toBeCloseTo(0.36);
	});

	it('does not trust a preset identity when the exact weights do not match', () => {
		const manifest = {
			model: { features: ['regard', 'reach', 'recognition'] },
			presets: [{ name: 'Balanced', weights: [0.35, 0.35, 0.3], settled: true, note: 'tested' }]
		} as unknown as ProminenceManifest;
		const state = lensState(manifest, [0.4, 0.3, 0.3], {
			presets: manifest.presets,
			presetId: 'Balanced'
		});
		expect(state.presetId).toBeNull();
		expect(state.displayName).toBe('Custom');
	});
});
