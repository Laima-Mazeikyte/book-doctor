import { describe, expect, it } from 'vitest';
import {
	buildDimensionMatchSnapshotsByBookId,
	dimensionMatchCopyKey,
	normalizeDimensionMatches,
	normalizeDimensionMatchSnapshots,
	type DimensionKey,
	type DimensionMatch
} from './dimensionMatches';

const spice = (score: number): DimensionMatch => ({
	dimension_key: 'spice',
	candidate_raw_score: score
});

const copyKey = (dimension: DimensionKey, index: number) =>
	`recommendations.dimensionMatches.values.${dimension}.${index}`;

const anchorCases: Array<{ dimension_key: DimensionKey; score: number; index: number }> = [
	...(['spice', 'vocabulary', 'pace', 'originality', 'violence'] as const).flatMap(
		(dimension_key) =>
			[0, 0.25, 0.5, 0.75, 1].map((score, index) => ({ dimension_key, score, index }))
	),
	...[0, 1 / 3, 2 / 3, 1].map((score, index) => ({
		dimension_key: 'depth' as const,
		score,
		index
	})),
	...[0, 0.5, 1].map((score, index) => ({
		dimension_key: 'discussion_potential' as const,
		score,
		index
	}))
];

const boundaryCases = [
	{
		dimension_key: 'spice' as const,
		boundaries: [0.125, 0.375, 0.625, 0.875]
	},
	{
		dimension_key: 'depth' as const,
		boundaries: [1 / 6, 0.5, 5 / 6]
	},
	{
		dimension_key: 'discussion_potential' as const,
		boundaries: [0.25, 0.75]
	}
].flatMap(({ dimension_key, boundaries }) =>
	boundaries.flatMap((boundary, index) => [
		{ dimension_key, score: boundary - 0.000001, expectedIndex: index },
		{ dimension_key, score: boundary, expectedIndex: index + 1 },
		{ dimension_key, score: boundary + 0.000001, expectedIndex: index + 1 }
	])
);

describe('dimension matches', () => {
	it.each([undefined, null, {}, '[]', 0])('accepts older or invalid empty fields: %s', (value) => {
		expect(normalizeDimensionMatches(value)).toEqual([]);
	});
	it('keeps zero, one, raw precision and output order while ignoring malformed and duplicate entries', () => {
		const valid = [
			spice(0),
			{ dimension_key: 'pace', candidate_raw_score: 1 },
			{ dimension_key: 'depth', candidate_raw_score: 0.20000000298023224 }
		];
		expect(
			normalizeDimensionMatches([
				...valid,
				spice(0.5),
				null,
				{},
				{ dimension_key: 'emotion', candidate_raw_score: 0.5 },
				{ dimension_key: 'violence', candidate_raw_score: '0.5' },
				{ dimension_key: 'vocabulary', candidate_raw_score: Infinity },
				{ dimension_key: 'originality', candidate_raw_score: NaN },
				{ dimension_key: 'violence', candidate_raw_score: -0.1 },
				{ dimension_key: 'violence', candidate_raw_score: 1.1 }
			])
		).toEqual(valid);
	});
	it('maps every score anchor to its copy key', () => {
		expect(anchorCases).toHaveLength(32);
		for (const { dimension_key, score, index } of anchorCases) {
			expect(dimensionMatchCopyKey({ dimension_key, candidate_raw_score: score })).toBe(
				copyKey(dimension_key, index)
			);
		}
	});
	it.each(boundaryCases)(
		'maps $dimension_key score $score to the nearest label',
		({ dimension_key, score, expectedIndex }) => {
			expect(dimensionMatchCopyKey({ dimension_key, candidate_raw_score: score })).toBe(
				copyKey(dimension_key, expectedIndex)
			);
		}
	);
	it.each([[], null, undefined])(
		'keeps the newest empty snapshot and its request identity (%s)',
		(value) => {
			expect(
				buildDimensionMatchSnapshotsByBookId([
					{ book_id: 'series', request_id: 'new', dimension_matches: value },
					{ book_id: 'series', request_id: 'old', dimension_matches: [spice(0)] }
				])
			).toEqual({ series: { request_id: 'new', matches: [] } });
		}
	);
	it('keeps canonical items distinct and does not merge later rows', () => {
		const result = buildDimensionMatchSnapshotsByBookId([
			{ book_id: 'series', request_id: 'new', dimension_matches: [spice(0)] },
			{
				book_id: 'series',
				request_id: 'old',
				dimension_matches: [{ dimension_key: 'pace', candidate_raw_score: 1 }]
			},
			{ book_id: 'other', request_id: 'old', dimension_matches: [spice(1)] }
		]);
		expect(result).toEqual({
			series: { request_id: 'new', matches: [spice(0)] },
			other: { request_id: 'old', matches: [spice(1)] }
		});
		expect(normalizeDimensionMatchSnapshots(JSON.parse(JSON.stringify(result)))).toEqual(result);
	});
});
