import { describe, expect, it } from 'vitest';
import { buildPickGrid, queryPickGrid, type PickArrays } from './picking';

function points(values: Array<[number, number, number, number]>): PickArrays {
	return {
		x: Float32Array.from(values.map(([x]) => x)),
		y: Float32Array.from(values.map(([, y]) => y)),
		depth: Float32Array.from(values.map(([, , depth]) => depth)),
		visible: Uint8Array.from(values.map(([, , , visible]) => visible))
	};
}

function query(
	arrays: PickArrays,
	x: number,
	y: number,
	rankBuckets: ArrayLike<number> = new Uint8Array(arrays.x.length),
	selectedIndex: number | null = null,
	cellSize = 28,
	baseHitRadius = 11,
	priorityHitRadius = 17
): number | null {
	const grid = buildPickGrid(arrays, 200, 200, cellSize);
	return queryPickGrid(
		grid,
		x,
		y,
		arrays,
		rankBuckets,
		selectedIndex,
		baseHitRadius,
		priorityHitRadius
	);
}

describe('screen-space picking grid', () => {
	it('chooses a closer point over a frontmost point that is 0.4px farther away', () => {
		const arrays = points([
			[40.4, 40, 0.01, 1],
			[40, 40, 0.9, 1]
		]);
		expect(query(arrays, 41, 40)).toBe(0);
	});

	it('uses frontmost depth only for exactly equal screen-space distance', () => {
		const arrays = points([
			[39, 40, 0.4, 1],
			[41, 40, 0.1, 1]
		]);
		expect(query(arrays, 40, 40)).toBe(1);
	});

	it('uses stable author index for equal distance and equal depth', () => {
		const arrays = points([
			[39, 40, 0.2, 1],
			[41, 40, 0.2, 1]
		]);
		expect(query(arrays, 40, 40)).toBe(0);
	});

	it('does not depend on candidate traversal order', () => {
		const arrays = points([
			[39, 40, 0.2, 1],
			[41, 40, 0.2, 1]
		]);
		const grid = buildPickGrid(arrays, 200, 200, 28);
		const cell = grid.cells.get('1,1');
		expect(cell).toEqual([0, 1]);
		cell?.reverse();
		expect(queryPickGrid(grid, 40, 40, arrays, new Uint8Array(2), null)).toBe(0);
	});

	it('examines candidates across adjacent cells', () => {
		const arrays = points([[10.9, 10.9, 0.2, 1]]);
		expect(query(arrays, 9.9, 9.9, undefined, null, 10, 2, 2)).toBe(0);
	});

	it('derives the neighboring-cell span from the largest hit radius', () => {
		const arrays = points([[20.1, 0.1, 0.2, 1]]);
		const leaders = Uint8Array.from([3]);
		expect(query(arrays, 0.1, 0.1, leaders, null, 10, 2, 21)).toBe(0);
	});

	it('uses priority and selected radii only for eligibility', () => {
		const closerOrdinary = points([
			[0, 0, 0.2, 1],
			[16, 0, 0.1, 1]
		]);
		expect(query(closerOrdinary, 0, 0, Uint8Array.from([0, 3]))).toBe(0);
		expect(query(closerOrdinary, 0, 0, undefined, 1)).toBe(0);

		const priorityOnly = points([[16, 0, 0.1, 1]]);
		expect(query(priorityOnly, 0, 0, Uint8Array.from([3]))).toBe(0);
		expect(query(priorityOnly, 0, 0)).toBeNull();

		const selectedOnly = points([[16, 0, 0.1, 1]]);
		expect(query(selectedOnly, 0, 0, undefined, 0)).toBe(0);
	});

	it('retains and examines every candidate in a dense cell', () => {
		const arrays = points(
			Array.from({ length: 40 }, (_, index) => [index === 32 ? 40 : 40.4, 40, index, 1]) as Array<
				[number, number, number, number]
			>
		);
		const grid = buildPickGrid(arrays, 120, 120, 28);
		expect(grid.cells.get('1,1')).toHaveLength(40);
		expect(queryPickGrid(grid, 40, 40, arrays, new Uint8Array(40), null)).toBe(32);
	});

	it('excludes invisible and out-of-radius candidates', () => {
		const arrays = points([
			[40, 40, 0.1, 0],
			[60, 40, 0.2, 1],
			[40, 40, 0.3, 1]
		]);
		expect(query(arrays, 40, 40)).toBe(2);
		expect(query(points([[60, 40, 0.2, 1]]), 40, 40)).toBeNull();
	});
});
