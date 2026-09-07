import { describe, expect, it } from 'vitest';
import { parseRecommendationRank, parseRecommendationTimestamp } from './recommendationFilters';

describe('parseRecommendationTimestamp', () => {
	it('returns null for missing or invalid values', () => {
		expect(parseRecommendationTimestamp(null)).toBeNull();
		expect(parseRecommendationTimestamp(undefined)).toBeNull();
		expect(parseRecommendationTimestamp('not-a-date')).toBeNull();
	});

	it('returns epoch ms for valid ISO timestamps', () => {
		const ts = parseRecommendationTimestamp('2026-01-15T12:00:00.000Z');
		expect(ts).toBe(Date.parse('2026-01-15T12:00:00.000Z'));
	});
});

describe('parseRecommendationRank', () => {
	it('accepts positive numbers and numeric strings', () => {
		expect(parseRecommendationRank(3)).toBe(3);
		expect(parseRecommendationRank('4')).toBe(4);
	});

	it('rejects zero, negative, and invalid values', () => {
		expect(parseRecommendationRank(0)).toBeNull();
		expect(parseRecommendationRank(-1)).toBeNull();
		expect(parseRecommendationRank('')).toBeNull();
		expect(parseRecommendationRank('abc')).toBeNull();
	});
});
