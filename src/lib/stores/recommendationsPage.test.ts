import { expect, it } from 'vitest';
import { createRecommendationsPageStore } from './recommendationsPage';
import type { DimensionMatchSnapshotsByBookId } from '$lib/recommendations/dimensionMatches';

it('isolates request snapshots, preserves cache for the same user, and clears on account changes', () => {
	const store = createRecommendationsPageStore();
	const first: DimensionMatchSnapshotsByBookId = {
		book: { request_id: 'first', matches: [{ dimension_key: 'spice', candidate_raw_score: 0 }] }
	};
	const second = { book: { request_id: 'second', matches: [] } };
	store.ensureUser('alice');
	store.setRunBooks('first', [], {}, {}, first);
	store.setRunBooks('second', [], {}, {}, second);
	store.setUniqueBooks([], {
		...store.getHistorySnapshot(),
		dimensionMatchSnapshotsByBookId: second
	});
	store.ensureUser('alice');
	expect(store.getRunDimensionMatches('first')).toEqual(first);
	expect(store.getRunDimensionMatches('second')).toEqual(second);
	expect(store.getHistorySnapshot().dimensionMatchSnapshotsByBookId).toEqual(second);
	store.ensureUser('bob');
	expect(store.getRunDimensionMatches('first')).toBeUndefined();
	expect(store.getRunDimensionMatches('second')).toBeUndefined();
	expect(store.getHistorySnapshot().dimensionMatchSnapshotsByBookId).toEqual({});
	store.setRunBooks('second', [], {}, {}, second);
	store.ensureUser(null);
	expect(store.getRunDimensionMatches('second')).toBeUndefined();
});
