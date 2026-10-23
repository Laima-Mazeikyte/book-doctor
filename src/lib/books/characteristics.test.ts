import { describe, expect, it } from 'vitest';
import { bookCharacteristics } from './characteristics';

describe('book reading characteristics', () => {
	it('uses inclusive extreme thresholds and the existing pace direction', () => {
		expect(
			bookCharacteristics({
				pace_value: 0.2,
				vocabulary_value: 0.8,
				originality_value: 0.8
			}).labels.map((item) => item.label)
		).toEqual(['Fast-paced', 'Demanding', 'Unconventional']);
		expect(
			bookCharacteristics({ pace_value: 0.8, vocabulary_value: 0.2, depth_value: 0.2 }).labels.map(
				(item) => item.label
			)
		).toEqual(['Unhurried', 'Accessible', 'Light']);
		expect(
			bookCharacteristics({ depth_value: 0.8, discussion_potential_value: 0.8 }).labels.map(
				(item) => item.label
			)
		).toEqual(['Deep', 'Thought-provoking']);
	});
	it('does not label low violence, low spice, low originality, or middle scores', () => {
		const result = bookCharacteristics({
			violence_value: 0.2,
			spice_value: 0,
			originality_value: 0.1,
			pace_value: 0.5,
			depth_value: 0.21,
			vocabulary_value: 0.79
		});
		expect(result.labels).toEqual([]);
		expect(result.availableDimensions).toBe(6);
		expect(
			bookCharacteristics({ violence_value: 0.8, spice_value: 0.8 }).labels.map(
				(item) => item.label
			)
		).toEqual(['Graphic', 'Explicit']);
	});
	it('distinguishes missing or invalid evidence from measured middle scores', () => {
		expect(bookCharacteristics(null).availableDimensions).toBe(0);
		expect(
			bookCharacteristics({
				pace_value: NaN,
				depth_value: -1,
				spice_value: 2,
				vocabulary_value: null
			}).availableDimensions
		).toBe(0);
		expect(bookCharacteristics({ pace_value: 0.5 }).availableDimensions).toBe(1);
	});
});
