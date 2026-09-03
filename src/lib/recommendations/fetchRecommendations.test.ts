import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	fetchRecommendations,
	RECOMMENDATIONS_POLL_INTERVAL_MS,
	RECOMMENDATIONS_POLL_TIMEOUT_MS
} from './fetchRecommendations';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('fetchRecommendations constants', () => {
	it('exports poll timing used by shortlist', () => {
		expect(RECOMMENDATIONS_POLL_INTERVAL_MS).toBe(3000);
		expect(RECOMMENDATIONS_POLL_TIMEOUT_MS).toBe(60_000);
	});

	it('reads author relationship candidates from the recommendation response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					books: [],
					request_id: 'request-1',
					likedBookPrecedentsByBookId: {},
					authorRelationshipAuthorsByBookId: {
						'book-1': ['Author one', 'Author two']
					}
				})
			})
		);

		expect(
			(await fetchRecommendations(null, 'request-1')).authorRelationshipAuthorsByBookId
		).toEqual({
			'book-1': ['Author one', 'Author two']
		});
	});
});
