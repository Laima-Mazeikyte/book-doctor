import { describe, expect, it } from 'vitest';
import { activeIndexFromScroll, scrollLeftForIndex } from './carouselIndex';

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
});
