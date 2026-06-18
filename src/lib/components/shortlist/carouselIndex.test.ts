import { describe, expect, it } from 'vitest';
import {
	activeIndexFromScroll,
	logicalIndexFromScrollSlot,
	loopSlideCount,
	scrollLeftForIndex,
	scrollLeftForSlot,
	scrollSlotForLogicalIndex,
	scrollSlotFromScrollLeft,
	teleportTargetSlot
} from './carouselIndex';

describe('carouselIndex', () => {
	const viewport = 400;

	it('returns 0 at start', () => {
		expect(activeIndexFromScroll(0, viewport, 5)).toBe(0);
	});

	it('returns 1 after one viewport scroll', () => {
		expect(activeIndexFromScroll(400, viewport, 5)).toBe(1);
	});

	it('clamps to last index', () => {
		expect(activeIndexFromScroll(9999, viewport, 3)).toBe(2);
	});

	it('scrollLeftForIndex maps index to pixel offset', () => {
		expect(scrollLeftForIndex(2, viewport)).toBe(800);
	});

	describe('loop carousel', () => {
		it('adds clone slots when more than one book', () => {
			expect(loopSlideCount(5)).toBe(7);
			expect(loopSlideCount(1)).toBe(1);
		});

		it('maps logical indices to real scroll slots', () => {
			expect(scrollSlotForLogicalIndex(0, 5)).toBe(1);
			expect(scrollSlotForLogicalIndex(4, 5)).toBe(5);
			expect(scrollSlotForLogicalIndex(0, 1)).toBe(0);
		});

		it('maps clone slots back to logical indices', () => {
			expect(logicalIndexFromScrollSlot(0, 5)).toBe(4);
			expect(logicalIndexFromScrollSlot(6, 5)).toBe(0);
			expect(logicalIndexFromScrollSlot(3, 5)).toBe(2);
		});

		it('returns teleport targets for clone slots', () => {
			expect(teleportTargetSlot(0, 5)).toBe(5);
			expect(teleportTargetSlot(6, 5)).toBe(1);
			expect(teleportTargetSlot(3, 5)).toBeNull();
		});

		it('derives scroll slot from scroll position', () => {
			expect(scrollSlotFromScrollLeft(400, viewport, 5)).toBe(1);
			expect(scrollSlotFromScrollLeft(2400, viewport, 5)).toBe(6);
		});

		it('scrollLeftForSlot matches slot index', () => {
			expect(scrollLeftForSlot(3, viewport)).toBe(1200);
		});
	});
});
