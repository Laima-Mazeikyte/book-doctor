import { expect, it } from 'vitest';
import { createRecommendationsPageStore } from './recommendationsPage';
import type { DimensionMatchSnapshotsByBookId } from '$lib/recommendations/dimensionMatches';

it('isolates request snapshots, preserves cache for the same user, and clears on account changes', () => {
	const store = createRecommendationsPageStore();
	const first: DimensionMatchSnapshotsByBookId = {
		book: { request_id: 'first', matches: [{ dimension_key: 'spice', candidate_raw_score: 0 }] }
	};
	const second = { book: { request_id: 'second', matches: [] } };
	const firstBooks = [{ id: 'book-first', book_id: 'first', title: 'First', author: 'Author' }];
	const secondBooks = [{ id: 'book-second', book_id: 'second', title: 'Second', author: 'Author' }];
	store.ensureUser('alice');
	store.setRun('first', {
		books: firstBooks,
		likedBookPrecedentsByBookId: {},
		authorRelationshipAuthorsByBookId: {},
		dimensionMatchSnapshotsByBookId: first
	});
	store.setRun('second', {
		books: secondBooks,
		likedBookPrecedentsByBookId: {},
		authorRelationshipAuthorsByBookId: {},
		dimensionMatchSnapshotsByBookId: second
	});
	store.setUniqueBooks([], {
		...store.getHistorySnapshot(),
		dimensionMatchSnapshotsByBookId: second
	});
	store.ensureUser('alice');
	expect(store.getRun('first')).toEqual({
		books: firstBooks,
		likedBookPrecedentsByBookId: {},
		authorRelationshipAuthorsByBookId: {},
		dimensionMatchSnapshotsByBookId: first
	});
	expect(store.getRun('second')).toEqual({
		books: secondBooks,
		likedBookPrecedentsByBookId: {},
		authorRelationshipAuthorsByBookId: {},
		dimensionMatchSnapshotsByBookId: second
	});
	expect(store.getHistorySnapshot().dimensionMatchSnapshotsByBookId).toEqual(second);
	store.ensureUser('bob');
	expect(store.getRun('first')).toBeUndefined();
	expect(store.getRun('second')).toBeUndefined();
	expect(store.getHistorySnapshot().dimensionMatchSnapshotsByBookId).toEqual({});
	store.setRun('second', {
		books: secondBooks,
		likedBookPrecedentsByBookId: {},
		authorRelationshipAuthorsByBookId: {},
		dimensionMatchSnapshotsByBookId: second
	});
	store.ensureUser(null);
	expect(store.getRun('second')).toBeUndefined();
});
