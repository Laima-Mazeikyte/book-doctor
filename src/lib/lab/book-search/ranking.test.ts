import { describe, expect, it } from 'vitest';
import { buildPopulation, matchingIndices, normalCdf, normaliseWeights, rank } from './ranking';
import type { BookRankingManifest, RankingMode } from './types';

const modes: RankingMode[] = ['best_books', 'best_series', 'polarizing_books', 'polarizing_series'];

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
	schema_version: 1,
	generated_utc: '2026-01-01T00:00:00Z',
	version: 'test',
	display: { top_n: 25 },
	datasets: Object.fromEntries(modes.map((mode) => [mode, mode + '.json'])) as Record<
		RankingMode,
		string
	>,
	model: {
		best_books: bestModel,
		best_series: bestModel,
		polarizing_books: polarizingModel,
		polarizing_series: polarizingModel
	},
	presets: Object.fromEntries(
		modes.map((mode) => [
			mode,
			[{ name: 'Default', weights: manifestWeights(mode), settled: false }]
		])
	) as BookRankingManifest['presets'],
	disclosure: { headline: '', items: [] },
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
					'item_id',
					'title',
					'author',
					'series_name',
					'regard_z',
					'reach_z',
					'recognition_z'
				],
				rows: [
					['a', 'Second', 'Author A', null, 1, 0, 0],
					['b', 'First', 'Author B', null, 0, 2, 0],
					['c', 'Third', 'Author C', null, 0, 0, 3]
				]
			},
			manifest,
			'best_books'
		);

		const ranking = rank(population, [0, 1, 0], bestModel.sigma_z);
		expect(Array.from(ranking.order)).toEqual([1, 0, 2]);
		expect(ranking.contributions[1][1]).toBe(2);
	});

	it('searches title, author, and series fields with accent-insensitive matching', () => {
		const population = buildPopulation(
			{
				columns: [
					'item_id',
					'title',
					'author',
					'series_name',
					'regard_z',
					'reach_z',
					'recognition_z'
				],
				rows: [
					['a', 'A Quiet Book', 'García Márquez', 'One Hundred Years', 1, 0, 0],
					['b', 'Another Book', 'Author B', null, 0, 1, 0]
				]
			},
			manifest,
			'best_books'
		);
		const ranking = rank(population, [1, 0, 0], bestModel.sigma_z);

		expect(matchingIndices(population, ranking, 'garcia')).toEqual([0]);
		expect(matchingIndices(population, ranking, 'one hundred')).toEqual([0]);
	});

	it('preserves every series cover id in the exported sequel order', () => {
		const population = buildPopulation(
			{
				columns: [
					'item_id',
					'title',
					'author',
					'series_name',
					'constituent_book_ids',
					'regard_z',
					'reach_z',
					'recognition_z'
				],
				rows: [
					['series-1', 'A series', 'Author', 'A series', ['book-2', 'book-1', 'book-3'], 1, 0, 0]
				]
			},
			manifest,
			'best_series'
		);

		expect(population.constituentBookIds[0]).toEqual(['book-2', 'book-1', 'book-3']);
	});

	it('keeps a neutral statistical polarization at the midpoint percentile', () => {
		expect(normalCdf(0)).toBeCloseTo(0.5, 5);
	});
});
