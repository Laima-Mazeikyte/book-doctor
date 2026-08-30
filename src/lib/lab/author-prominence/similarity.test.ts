import { describe, expect, it } from 'vitest';
import { calculateSimilarProfiles } from './similarity';
import type { Population } from './types';

function population(): Population {
	return {
		count: 5,
		names: ['Selected', 'Far', 'Near B', 'Near A', 'Other'],
		authorIds: null,
		z: [
			Float64Array.from([0, 1, 0.1, 0.1, 0]),
			Float64Array.from([0, 0, 0.1, 0.1, 2]),
			Float64Array.from([0, 0, 0, 0, 0])
		],
		hasRecognition: new Uint8Array(5),
		nBooks: new Int32Array(5),
		bestTier: new Int8Array(5),
		nAwards: new Int32Array(5),
		concentration: new Float64Array(5)
	};
}

describe('similar prominence profiles', () => {
	it('uses the three-dimensional Mahalanobis distance and excludes the selection', () => {
		const profiles = calculateSimilarProfiles({
			population: population(),
			sigmaZ: [
				[1, 0.5, 0],
				[0.5, 1, 0],
				[0, 0, 1]
			],
			selectedIndex: 0,
			limit: 3
		});
		expect(profiles.map((profile) => profile.index)).toEqual([3, 2, 1]);
		expect(profiles[0].distance).toBeCloseTo(Math.sqrt(0.0133333333), 5);
		expect(profiles.some((profile) => profile.index === 0)).toBe(false);
	});

	it('breaks equal-distance profiles by author name then population index', () => {
		const profiles = calculateSimilarProfiles({
			population: population(),
			sigmaZ: [
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			selectedIndex: 0,
			limit: 2
		});
		expect(profiles.map((profile) => profile.index)).toEqual([3, 2]);
	});
});
