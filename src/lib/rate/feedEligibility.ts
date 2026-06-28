/** Minimum rated / bookmarked / not-interested books before requesting a personalized feed. */
export const MIN_INTERACTIONS_FOR_RATE_FEED = 3;

export type LatestRateFeedMode =
	| 'has_eligible_feed'
	| 'feed_exhausted'
	| 'feed_generation_pending'
	| 'no_feed_yet'
	| 'feed_error'
	| 'below_threshold';

export type RateFeedStateSnapshot = {
	mode: LatestRateFeedMode;
	books: unknown[];
	/** Ratings + bookmarks + not-interested (server or client). */
	interaction_count?: number;
	/** Ratings only — legacy field from /api/feed/latest. */
	ratings_count?: number;
	eligible_for_feed?: boolean;
};

export function feedInteractionCountFromParts(parts: {
	ratings: number;
	bookmarks: number;
	notInterested: number;
}): number {
	return parts.ratings + parts.bookmarks + parts.notInterested;
}

export function meetsRateFeedInteractionThreshold(count: number): boolean {
	return count >= MIN_INTERACTIONS_FOR_RATE_FEED;
}

export function interactionCountFromFeedState(state: RateFeedStateSnapshot): number {
	return state.interaction_count ?? state.ratings_count ?? 0;
}

export function feedStateMeetsInteractionThreshold(state: RateFeedStateSnapshot): boolean {
	if (state.eligible_for_feed === false) return false;
	if (state.mode === 'below_threshold') return false;
	return meetsRateFeedInteractionThreshold(interactionCountFromFeedState(state));
}

export function shouldShowLatestRateFeed(state: RateFeedStateSnapshot): boolean {
	return (
		feedStateMeetsInteractionThreshold(state) &&
		state.mode === 'has_eligible_feed' &&
		Array.isArray(state.books) &&
		state.books.length > 0
	);
}

export function shouldRequestInitialPersonalizedFeed(state: RateFeedStateSnapshot): boolean {
	if (!feedStateMeetsInteractionThreshold(state)) return false;
	if (state.mode === 'has_eligible_feed') return false;
	return true;
}
