import { describe, expect, it } from 'vitest';
import { changeOneShare, largestRemainderShares, lensState } from './lens';
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
		expect(state.displayName).toBe('Custom lens');
	});
});
