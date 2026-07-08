import { describe, expect, it } from 'vitest';
import {
	MIN_INTERACTIONS_FOR_RATE_FEED,
	feedInteractionCountFromParts,
	feedStateMeetsInteractionThreshold,
	meetsRateFeedInteractionThreshold,
	shouldRequestInitialPersonalizedFeed,
	shouldShowLatestRateFeed
} from './feedEligibility';

describe('feedEligibility', () => {
	it('sums ratings, bookmarks, and not-interested for interaction count', () => {
		expect(
			feedInteractionCountFromParts({ ratings: 1, bookmarks: 1, notInterested: 1 })
		).toBe(3);
	});

	it('unlocks the feed at a single interaction, but not at zero', () => {
		expect(MIN_INTERACTIONS_FOR_RATE_FEED).toBe(1);
		expect(meetsRateFeedInteractionThreshold(0)).toBe(false);
		expect(meetsRateFeedInteractionThreshold(1)).toBe(true);
	});

	it('meets the threshold with a single interaction when the server marks it eligible', () => {
		expect(
			feedStateMeetsInteractionThreshold({
				mode: 'no_feed_yet',
				books: [],
				interaction_count: 1,
				eligible_for_feed: true
			})
		).toBe(true);
	});

	it('does not show latest feed below threshold even with eligible books', () => {
		expect(
			shouldShowLatestRateFeed({
				mode: 'has_eligible_feed',
				books: [{ id: '1' }],
				interaction_count: 0,
				eligible_for_feed: false
			})
		).toBe(false);
	});

	it('shows latest feed when interaction threshold is met', () => {
		expect(
			shouldShowLatestRateFeed({
				mode: 'has_eligible_feed',
				books: [{ id: '1' }],
				interaction_count: 3,
				eligible_for_feed: true
			})
		).toBe(true);
	});

		it('treats below_threshold mode as ineligible', () => {
			expect(
				feedStateMeetsInteractionThreshold({
					mode: 'below_threshold',
					books: [],
					interaction_count: 2,
					eligible_for_feed: false
				})
			).toBe(false);
		});

	it('requests initial personalized feed only when eligible and not already hydrated', () => {
		expect(
			shouldRequestInitialPersonalizedFeed({
				mode: 'no_feed_yet',
				books: [],
				interaction_count: 3,
				eligible_for_feed: true
			})
		).toBe(true);

		expect(
			shouldRequestInitialPersonalizedFeed({
				mode: 'has_eligible_feed',
				books: [{ id: '1' }],
				interaction_count: 3,
				eligible_for_feed: true
			})
		).toBe(false);
	});
});
