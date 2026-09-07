import { describe, expect, it } from 'vitest';
import type { Book } from '$lib/types/book';
import { filterRatedLikedBookPrecedents } from './likedBookPrecedents';

function book(id: string): Book {
	return {
		id,
		book_id: `ulid-${id}`,
		title: id,
		author: 'Author'
	};
}

describe('filterRatedLikedBookPrecedents', () => {
	it('keeps only liked-rated books while preserving backend order', () => {
		const precedents = [book('liked-1'), book('low-rated'), book('unrated'), book('liked-2')];

		expect(
			filterRatedLikedBookPrecedents(
				precedents,
				new Map([
					['liked-1', 5],
					['low-rated', 1],
					['liked-2', 4]
				])
			).map(({ id }) => id)
		).toEqual(['liked-1', 'liked-2']);
	});

	it('returns no precedents when there are no liked ratings', () => {
		expect(
			filterRatedLikedBookPrecedents(
				[book('one-star'), book('three-stars'), book('unrated')],
				new Map([
					['one-star', 1],
					['three-stars', 3]
				])
			)
		).toEqual([]);
	});
});
