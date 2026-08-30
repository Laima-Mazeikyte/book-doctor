import { describe, expect, it } from 'vitest';
import { calculateImmediateRanking } from './immediate-ranking';
import { computeRanking, contributionsFor, scoreFor } from './ranking-engine';
import type { Population, Preset } from './types';

const sigmaZ = [
	[1, 0.12, -0.08],
	[0.12, 1, 0.16],
	[-0.08, 0.16, 1]
];
const presets: Preset[] = [
	{ name: 'Balanced', weights: [0.4, 0.35, 0.25], settled: true, note: '' },
	{ name: 'Most read', weights: [0.15, 0.7, 0.15], settled: false, note: '' }
];

function fixturePopulation(count = 7): Population {
	const names = Array.from(
		{ length: count },
		(_, index) =>
			['Zed', 'Alpha', 'Mina', 'Owen', 'Bea', 'Iris', 'Noah'][index] ?? `Author ${index}`
	);
	return {
		count,
		names,
		authorIds: null,
		z: [
			Float64Array.from({ length: count }, (_, index) => Math.sin(index * 1.7) * 2),
			Float64Array.from({ length: count }, (_, index) => Math.cos(index * 0.9) * 1.5),
			Float64Array.from({ length: count }, (_, index) => (index % 3) - 1)
		],
		hasRecognition: new Uint8Array(count),
		nBooks: new Int32Array(count),
		bestTier: new Int8Array(count),
		nAwards: new Int32Array(count),
		concentration: new Float64Array(count)
	};
}

describe('immediate selected-author ranking', () => {
	it('matches the authoritative worker score, contributions, and exact rank', () => {
		const population = fixturePopulation();
		for (let iteration = 0; iteration < 20; iteration++) {
			const raw = [
				0.05 + ((iteration * 17) % 89) / 100,
				0.05 + ((iteration * 29) % 73) / 100,
				0.05 + ((iteration * 43) % 61) / 100
			];
			const total = raw.reduce((sum, value) => sum + value, 0);
			const weights = raw.map((value) => value / total);
			const selectedIndex = iteration % population.count;
			const visibleIndices = [0, 2, 4, selectedIndex];
			const expected = computeRanking({
				population,
				sigmaZ,
				settledPreset: presets[0],
				topN: population.count,
				weights,
				selectedIndex,
				revision: iteration + 1
			});
			const actual = calculateImmediateRanking({
				population,
				sigmaZ,
				weights,
				visibleIndices,
				selectedIndex
			});
			const selected = actual.selected;
			expect(selected).not.toBeNull();
			if (!selected) return;
			expect(selected.score).toBe(scoreFor(expected, selectedIndex));
			expect(selected.place).toBe(expected.rankByIndex[selectedIndex]);
			expect(selected.values).toEqual(contributionsFor(expected, selectedIndex));
			expect(selected.values.reduce((sum, value) => sum + value, 0)).toBeCloseTo(
				selected.score,
				12
			);

			for (const index of visibleIndices) {
				const metric = actual.byIndex.get(index);
				expect(metric).toBeDefined();
				if (!metric) continue;
				expect(metric.score).toBe(scoreFor(expected, index));
				expect(metric.values).toEqual(contributionsFor(expected, index));
			}
		}
	});

	it('uses name and stable index ordering for exact score ties', () => {
		const population = fixturePopulation(4);
		population.names = ['Same', 'Before', 'Same', 'After'];
		population.z = [
			Float64Array.from([1, 1, 1, 0]),
			Float64Array.from([0, 0, 0, 0]),
			Float64Array.from([0, 0, 0, 0])
		];
		const actual = calculateImmediateRanking({
			population,
			sigmaZ: [
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			weights: [1, 0, 0],
			visibleIndices: [],
			selectedIndex: 0
		});
		expect(actual.selected?.place).toBe(2);

		const equalName = calculateImmediateRanking({
			population,
			sigmaZ: [
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			weights: [1, 0, 0],
			visibleIndices: [],
			selectedIndex: 2
		});
		expect(equalName.selected?.place).toBe(3);
	});
});
