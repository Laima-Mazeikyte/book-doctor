import { describe, expect, it } from 'vitest';

import { computeSearchHasMore } from './client';

describe('computeSearchHasMore', () => {
	const limit = 24;

	it('returns false when there are no hits', () => {
		expect(computeSearchHasMore(0, limit, 0, 64)).toBe(false);
	});

	it('continues after a full page even if estimatedTotalHits equals first-page offset (underestimate)', () => {
		expect(computeSearchHasMore(24, limit, 24, 24)).toBe(true);
	});

	it('uses estimate when last page is short', () => {
		expect(computeSearchHasMore(16, limit, 64, 64)).toBe(false);
	});

	it('continues on a full page when estimate says more', () => {
		expect(computeSearchHasMore(24, limit, 24, 64)).toBe(true);
	});

	it('continues on a full page when estimate is absent', () => {
		expect(computeSearchHasMore(24, limit, 24, null)).toBe(true);
	});

	it('stops after a short final page when estimate is absent', () => {
		expect(computeSearchHasMore(10, limit, 10, null)).toBe(false);
	});
});
