import { describe, expect, it } from 'vitest';
import {
	isVisibleQualityBand,
	normalizeQualityBand,
	qualityPercentileFromValue,
	VISIBLE_QUALITY_BANDS
} from './qualityEvidence';

describe('quality evidence', () => {
	it('accepts the known release bands and rejects unknown values', () => {
		for (const band of VISIBLE_QUALITY_BANDS) {
			expect(normalizeQualityBand(` ${band} `)).toBe(band);
			expect(isVisibleQualityBand(band)).toBe(true);
		}

		expect(normalizeQualityBand('below_top_25')).toBe('below_top_25');
		expect(isVisibleQualityBand('below_top_25')).toBe(false);
		expect(normalizeQualityBand('top_2_percent')).toBeNull();
		expect(normalizeQualityBand(null)).toBeNull();
	});

	it('normalizes finite numeric percentile values without using them for band visibility', () => {
		expect(qualityPercentileFromValue(96.42)).toBe(96.42);
		expect(qualityPercentileFromValue('96.42')).toBe(96.42);
		expect(qualityPercentileFromValue(Number.NaN)).toBeNull();
		expect(qualityPercentileFromValue('not-a-number')).toBeNull();
	});
});
