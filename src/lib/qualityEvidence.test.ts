import { describe, expect, it } from 'vitest';
import {
	isVisibleQualityBand,
	normalizeQualityBand,
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
});
