import { describe, expect, it } from 'vitest';
import {
	logicalIndexFromScrollSlot,
	scrollSlotForLogicalIndex,
	teleportTargetSlot
} from './carouselIndex';

describe('loop carousel indices', () => {
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
});
