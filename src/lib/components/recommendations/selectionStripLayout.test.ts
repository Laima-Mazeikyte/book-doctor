import { expect, it } from 'vitest';
import { selectionStripLayout, STRIP_PADDING } from './selectionStripLayout';

it('leaves fitted selections at their normal height without looping', () => {
	expect(selectionStripLayout([2 / 3, 2 / 3, 2 / 3], 390, 168)).toEqual({
		overflowing: false,
		looping: false,
		height: 168
	});
});

it('fits a single unusually wide jacket without cropping or repeating it', () => {
	const layout = selectionStripLayout([2], 390, 252);
	expect(layout.overflowing).toBe(false);
	expect(layout.height * 2).toBe(390 - STRIP_PADDING * 2);
});

it('always loops overflowing selections without changing cover height', () => {
	for (const viewport of [350, 390, 1200, 1440]) {
		for (let count = 2; count <= 200; count++) {
			const ratios = Array.from({ length: count }, (_, index) => [0.5, 2 / 3, 0.8][index % 3]);
			const layout = selectionStripLayout(ratios, viewport, 220);
			expect(layout.height).toBe(220);
			expect(layout.looping).toBe(layout.overflowing);
		}
	}
});

it('loops the tightest overflow as well as longer selections at the same height', () => {
	expect(selectionStripLayout(Array(4).fill(2 / 3), 390, 168)).toEqual({
		overflowing: true,
		looping: true,
		height: 168
	});
	expect(selectionStripLayout(Array(8).fill(2 / 3), 390, 168)).toEqual({
		overflowing: true,
		looping: true,
		height: 168
	});
});
