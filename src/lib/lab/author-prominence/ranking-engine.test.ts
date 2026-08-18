import { describe, expect, it } from 'vitest';
import { computeRanking } from './ranking-engine';
import type { Population, Preset } from './types';

const population: Population = {
	count: 4,
	names: ['Beta', 'Alpha', 'Delta', 'Gamma'],
	authorIds: null,
	z: [
		Float64Array.from([2, 1, 0, -1]),
		Float64Array.from([0, 1, 3, -1]),
		Float64Array.from([0, 0, 1, 2])
	],
	hasRecognition: Uint8Array.from([1, 1, 1, 1]),
	nBooks: new Int32Array(4),
	nReaders: new Int32Array(4),
	bestTier: new Int8Array(4),
	nAwards: new Int32Array(4),
	concentration: new Float64Array(4)
};
const presets: Preset[] = [
	{ name: 'Regard', weights: [1, 0, 0], settled: true, note: 'default' },
	{ name: 'Recognition', weights: [0, 0, 1], settled: false, note: '' }
];

describe('exact ranking engine result contract', () => {
	it('returns complete ranks, bounded overlays, selected contributions and cached profiles', () => {
		const result = computeRanking({
			population,
			sigmaZ: [
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			presets,
			topN: 2,
			weights: [0, 0, 1],
			selectedIndex: 1,
			revision: 7
		});
		expect(result.revision).toBe(7);
		expect(result.weights).toEqual([0, 0, 1]);
		expect(result.lens.displayName).toBe('Recognition');
		expect(Array.from(result.top250)).toEqual([3, 2, 1, 0]);
		expect(Array.from(result.rankByIndex)).toEqual([4, 3, 2, 1]);
		expect(Array.from(result.rankBuckets)).toEqual([2, 2, 3, 3]);
		expect(Array.from(result.scoreIndices)).toContain(1);
		expect(result.selectedContributions?.[2]).toBe(0);
		expect(
			Array.from(result.selectedContributions ?? []).reduce((sum, value) => sum + value, 0)
		).toBeCloseTo(result.scoreValues[result.scoreIndices.indexOf(1)]);
		expect(result.presetProfiles).toEqual([
			{ name: 'Regard', place: 2, settled: true },
			{ name: 'Recognition', place: 3, settled: false }
		]);
	});
});
