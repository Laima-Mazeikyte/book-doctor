import { describe, expect, it } from 'vitest';
import { formatInterval, formatPValue, formatPercent, groupNumber, wilsonInterval } from './format';

describe('number formatting', () => {
	it('formats shares, intervals and p-values', () => {
		expect(formatPercent(0.125)).toBe('12.5%');
		expect(formatInterval([0.085, 0.17])).toBe('8.5–17.0%');
		expect(formatPValue(0.0093)).toBe('= 0.009');
		expect(formatPValue(2e-8)).toBe('< 0.001');
		expect(groupNumber('history_q3')).toBe(3);
	});
});

describe('wilson interval', () => {
	it('matches the textbook score interval and leans upward near zero', () => {
		const [low, high] = wilsonInterval(25, 200);
		expect(low).toBeCloseTo(0.0861, 4);
		expect(high).toBeCloseTo(0.178, 4);
		const [lowFew, highFew] = wilsonInterval(5, 100);
		expect(lowFew).toBeCloseTo(0.0215, 4);
		expect(highFew).toBeCloseTo(0.1118, 4);
		expect(0.05 - lowFew).toBeLessThan(highFew - 0.05);
	});

	it('stays inside [0, 1] at the edges', () => {
		expect(wilsonInterval(0, 10)[0]).toBe(0);
		expect(wilsonInterval(10, 10)[1]).toBeCloseTo(1, 12);
		expect(wilsonInterval(0, 0)).toEqual([0, 0]);
	});
});
