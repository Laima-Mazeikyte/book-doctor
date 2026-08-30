import { describe, expect, it } from 'vitest';
import { computeDimensionStandings, standingPercentileBadge } from './standings';
import type { Population } from './types';

const population: Population = {
	count: 4,
	names: ['Zulu', 'Alpha', 'Bravo', 'Charlie'],
	authorIds: null,
	z: [
		Float64Array.from([1, 2, 2, -1]),
		Float64Array.from([0, -1, 3, 3]),
		Float64Array.from([2, 2, 0, 1])
	],
	hasRecognition: new Uint8Array(4),
	nBooks: new Int32Array(4),
	bestTier: new Int8Array(4),
	nAwards: new Int32Array(4),
	concentration: new Float64Array(4)
};

describe('dimension standings', () => {
	it('ranks descending z-values with name then index tie-breaking', () => {
		const standings = computeDimensionStandings(population);
		expect(Array.from(standings.byFeature.regard)).toEqual([3, 1, 2, 4]);
		expect(Array.from(standings.byFeature.reach)).toEqual([3, 4, 1, 2]);
		expect(Array.from(standings.byFeature.recognition)).toEqual([2, 1, 4, 3]);
	});

	it('only reports percentile brackets supported by the exact rank', () => {
		expect(standingPercentileBadge(1, 1000)).toBe('Top 0.1%');
		expect(standingPercentileBadge(2, 1000)).toBe('Top 1%');
		expect(standingPercentileBadge(10, 1000)).toBe('Top 1%');
		expect(standingPercentileBadge(50, 1000)).toBe('Top 5%');
		expect(standingPercentileBadge(100, 1000)).toBe('Top 10%');
		expect(standingPercentileBadge(101, 1000)).toBeNull();
	});
});
