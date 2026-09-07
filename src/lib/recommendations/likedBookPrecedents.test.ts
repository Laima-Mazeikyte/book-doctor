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
	it('keeps only rated books while preserving backend order', () => {
		const precedents = [book('rated-1'), book('bookmarked-only'), book('rated-2')];

		expect(
			filterRatedLikedBookPrecedents(precedents, new Set(['rated-2', 'rated-1'])).map(
				({ id }) => id
			)
		).toEqual(['rated-1', 'rated-2']);
	});

	it('returns no precedents when there are no rated books', () => {
		expect(filterRatedLikedBookPrecedents([book('bookmarked-only')], new Set())).toEqual([]);
	});
});
