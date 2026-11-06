import { expect, it } from 'vitest';
import { virtualFeedRows } from './virtualFeedRows';

it.each([2, 3, 5, 8])(
	'preserves full grid height with %i columns and disconnected retained rows',
	(columns) => {
		const cells = virtualFeedRows({
			count: 1001,
			columns,
			rowHeight: 350,
			gap: 8,
			top: 30000,
			viewportHeight: 900,
			pinned: [0, 999]
		});
		const items = cells.filter((cell) => cell.kind === 'item');
		expect(items.length).toBeLessThan(180);
		expect(items.some((cell) => cell.index === 0)).toBe(true);
		expect(items.some((cell) => cell.index === 999)).toBe(true);
		let height = 0;
		let currentRow = -1;
		for (const cell of cells) {
			if (cell.kind === 'spacer') {
				height += cell.height + 8;
				currentRow = -1;
			} else if (Math.floor(cell.index / columns) !== currentRow) {
				height += 358;
				currentRow = Math.floor(cell.index / columns);
			}
		}
		expect(height - 8).toBe(Math.ceil(1001 / columns) * 358 - 8);
	}
);

it('covers jumps to either end, ignores stale pins, and handles an empty list', () => {
	const options = { count: 1000, columns: 5, rowHeight: 350, gap: 8, viewportHeight: 900 };
	const start = virtualFeedRows({ ...options, top: -500, pinned: [-1, 1000] });
	expect(start[0]).toEqual({ kind: 'item', index: 0 });
	const end = virtualFeedRows({ ...options, top: 100000 });
	expect(end.at(-1)).toEqual({ kind: 'item', index: 999 });
	expect(virtualFeedRows({ ...options, count: 0, top: 0 })).toEqual([]);
});
