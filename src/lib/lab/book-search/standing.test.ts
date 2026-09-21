import { describe, expect, it } from 'vitest';
import { featureStanding } from './standing';

describe('feature standing', () => {
	it('uses the full population and includes all ties in the top share', () => {
		const values = new Float64Array([5, 3, 3, -1]);
		expect(featureStanding(values, 0)).toEqual({ rank: 1, top: '25.0%' });
		expect(featureStanding(values, 1)).toEqual({ rank: 2, top: '75.0%' });
		expect(featureStanding(values, 2)).toEqual({ rank: 2, top: '75.0%' });
		expect(featureStanding(values, 3)).toEqual({ rank: 4, top: '100.0%' });
	});
	it('does not imply distinction when every score is equal', () => {
		expect(featureStanding(new Float64Array([0, 0, 0]), 0).top).toBe('100.0%');
	});
	it('does not let floating-point noise round a share up', () => {
		// 7 / 1000 * 100 is 0.7000000000000001 in floating point.
		const values = new Float64Array(1000).map((_, index) => 1000 - index);
		expect(featureStanding(values, 6).top).toBe('0.7%');
		expect(featureStanding(values, 28).top).toBe('2.9%');
		expect(featureStanding(values, 7).top).toBe('0.8%');
	});
	it('never rounds a very small top share to zero', () => {
		const values = new Float64Array(64674);
		values[0] = 5;
		expect(featureStanding(values, 0).top).toBe('<0.1%');
	});
});
