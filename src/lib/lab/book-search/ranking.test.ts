import { describe, expect, it } from 'vitest';
import {
	buildPopulation,
	formatScore,
	inverseNormalCdf,
	matchingIndices,
	normalCdf,
	normaliseWeights,
	placeOf,
	rank
} from './ranking';
import type { BookRankingManifest, RankingMode } from './types';

const modes: RankingMode[] = ['best_items', 'polarizing_items'];

const bestModel = {
	features: ['regard', 'reach', 'recognition'],
	sigma_z: [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1]
	],
	default_weights: [0.4, 0.3, 0.3]
};

const polarizingModel = {
	features: ['disagreement', 'balance', 'intensity'],
	sigma_z: [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1]
	],
	default_weights: [0.4, 0.4, 0.2],
	default_reach_share: 0.3
};

function manifestWeights(mode: RankingMode): number[] {
	return mode.startsWith('polarizing_')
		? polarizingModel.default_weights
		: bestModel.default_weights;
}

const manifest = {
	schema_version: 2,
	version: 'test',
	datasets: Object.fromEntries(modes.map((mode) => [mode, mode + '.json'])) as Record<
		RankingMode,
		string
	>,
	model: {
		best_items: bestModel,
		polarizing_items: polarizingModel
	},
	presets: Object.fromEntries(
		modes.map((mode) => [mode, [{ name: 'Default', weights: manifestWeights(mode) }]])
	) as BookRankingManifest['presets'],
	quality: {
		items: Object.fromEntries(modes.map((mode) => [mode, 3])) as Record<RankingMode, number>
	}
} as BookRankingManifest;

describe('book ranking', () => {
	it('normalises slider positions and falls back when all handles are down', () => {
		expect(normaliseWeights([70, 15, 15], [0.4, 0.3, 0.3])).toEqual([0.7, 0.15, 0.15]);
		expect(normaliseWeights([0, 0, 0], [0.4, 0.3, 0.3])).toEqual([0.4, 0.3, 0.3]);
	});

	it('ranks the complete population using the selected feature mix', () => {
		const population = buildPopulation(
			{
				columns: [
					'item_type',
					'constituent_book_ids',
					'item_id',
					'title',
					'author',
					'series_name',
					'regard_z',
					'reach_z',
					'recognition_z'
				],
				rows: [
					['book', ['source-a'], 'a', 'Second', 'Author A', null, 1, 0, 0],
					['series', ['source-b', 'source-b2'], 'b', 'First', 'Author B', null, 0, 2, 0],
					['book', ['source-c'], 'c', 'Third', 'Author C', null, 0, 0, 3]
				]
			},
			manifest,
			'best_items'
		);

		const ranking = rank(population, [0, 1, 0], bestModel.sigma_z);
		expect(Array.from(ranking.order)).toEqual([1, 0, 2]);
		expect([0, 1, 2].map((index) => placeOf(ranking, index))).toEqual([2, 1, 3]);
		expect(ranking.scores[1]).toBe(2);
		expect(population.itemTypes).toEqual(['book', 'series', 'book']);
		expect(population.count).toBe(3);
	});

	it('searches title, author, and series fields with accent-insensitive matching', () => {
		const population = buildPopulation(
			{
				columns: [
					'item_type',
					'constituent_book_ids',
					'item_id',
					'title',
					'author',
					'series_name',
					'regard_z',
					'reach_z',
					'recognition_z'
				],
				rows: [
					[
						'book',
						['source-a'],
						'a',
						'A Quiet Book',
						'García Márquez',
						'One Hundred Years',
						1,
						0,
						0
					],
					['series', ['source-b', 'source-b2'], 'b', 'Another Book', 'Author B', null, 0, 1, 0]
				]
			},
			manifest,
			'best_items'
		);
		const ranking = rank(population, [1, 0, 0], bestModel.sigma_z);

		expect(matchingIndices(population, ranking, 'garcia')).toEqual([0]);
		expect(matchingIndices(population, ranking, 'one hundred')).toEqual([0]);
		expect(matchingIndices(population, ranking, '  GARCÍA  ')).toEqual([0]);
		expect(matchingIndices(population, ranking, 'book')).toEqual([0, 1]);
		// A cached text index must still follow the current weights, not the initial order.
		const reranked = rank(population, [0, 1, 0], bestModel.sigma_z);
		expect(matchingIndices(population, reranked, 'book')).toEqual([1, 0]);
		expect(placeOf(reranked, 1)).toBe(1);
		expect(matchingIndices(population, reranked, ' ')).toEqual([1, 0]);
		expect(matchingIndices(population, reranked, 'unmatched')).toEqual([]);
	});

	it('preserves every series cover id in the exported sequel order', () => {
		const population = buildPopulation(
			{
				columns: [
					'item_type',
					'constituent_book_ids',
					'item_id',
					'title',
					'author',
					'series_name',
					'regard_z',
					'reach_z',
					'recognition_z'
				],
				rows: [
					[
						'series',
						['book-2', 'book-1', 'book-3'],
						'series-1',
						'A series',
						'Author',
						'A series',
						1,
						0,
						0
					]
				]
			},
			manifest,
			'best_items'
		);

		expect(population.constituentBookIds[0]).toEqual(['book-2', 'book-1', 'book-3']);
	});

	it('keeps a neutral statistical polarization at the midpoint percentile', () => {
		expect(normalCdf(0)).toBeCloseTo(0.5, 7);
		expect(normalCdf(1.959964)).toBeCloseTo(0.975, 7);
		expect(normalCdf(-3.431614)).toBeCloseTo(0.0003, 8);
	});

	it('inverts the normal CDF across the body and tails', () => {
		expect(inverseNormalCdf(0.5)).toBe(0);
		expect(inverseNormalCdf(0.975)).toBeCloseTo(1.959964, 6);
		expect(inverseNormalCdf(0.9997)).toBeCloseTo(3.431614, 5);
		expect(inverseNormalCdf(1e-6)).toBeCloseTo(-4.753424, 5);
		expect(inverseNormalCdf(0.2)).toBeCloseTo(-inverseNormalCdf(0.8), 12);
		for (const value of [-4, -2.5, -0.3, 0.7, 2, 4.5]) {
			expect(inverseNormalCdf(normalCdf(value))).toBeCloseTo(value, 5);
		}
		expect(inverseNormalCdf(0)).toBe(-Infinity);
		expect(inverseNormalCdf(1)).toBe(Infinity);
	});

	it('formats scores with a sign and two decimals', () => {
		expect(formatScore(2.6849)).toBe('+2.68');
		expect(formatScore(0)).toBe('+0.00');
		expect(formatScore(-0.5)).toBe('-0.50');
	});

	it('applies the same polarization and cultural-reach model to books and series', () => {
		const population = buildPopulation(
			{
				columns: [
					'item_id',
					'item_type',
					'title',
					'author',
					'series_name',
					'constituent_book_ids',
					'disagreement_z',
					'balance_z',
					'intensity_z',
					'cultural_reach_z'
				],
				rows: [
					['a', 'book', 'A', 'Author', null, ['source-a'], 1, 0, 0, -1],
					['b', 'series', 'B', 'Author', 'B', ['volume-1', 'volume-2'], 1, 0, 0, 1]
				]
			},
			manifest,
			'polarizing_items'
		);
		const pure = rank(population, [1, 0, 0], polarizingModel.sigma_z, 0);
		const cultural = rank(population, [1, 0, 0], polarizingModel.sigma_z, 0.3);
		expect(pure.scores[0]).toBe(pure.scores[1]);
		// With popularity off, the score is the statistical z itself.
		expect(pure.scores[0]).toBeCloseTo(1, 5);
		expect(cultural.scores[0]).toBeCloseTo(
			inverseNormalCdf(normalCdf(1) ** 0.7 * normalCdf(-1) ** 0.3),
			10
		);
		expect(cultural.scores[0]).toBeLessThan(1);
		expect(cultural.scores[1]).toBeCloseTo(1, 5);
		expect(Array.from(cultural.order)).toEqual([1, 0]);
	});
});
