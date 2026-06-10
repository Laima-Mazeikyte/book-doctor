import { describe, expect, it } from 'vitest';
import {
	RECOMMENDATIONS_POLL_INTERVAL_MS,
	RECOMMENDATIONS_POLL_TIMEOUT_MS
} from './fetchRecommendations';

describe('fetchRecommendations constants', () => {
	it('exports poll timing used by shortlist', () => {
		expect(RECOMMENDATIONS_POLL_INTERVAL_MS).toBe(3000);
		expect(RECOMMENDATIONS_POLL_TIMEOUT_MS).toBe(60_000);
	});
});
