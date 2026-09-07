import { describe, expect, it } from 'vitest';
import type { Book } from '$lib/types/book';
import { sortRecHistoryBooks } from './sortRecHistoryBooks';

const book = (bookId: string, title: string): Book => ({
	id: bookId,
	book_id: bookId,
	title,
	author: 'Author'
});

describe('sortRecHistoryBooks', () => {
	it('sorts newest and oldest by recency, then title', () => {
		const books = [book('old', 'Zulu'), book('new', 'Beta'), book('tie', 'Alpha')];
		const lastAt = { old: 100, new: 200, tie: 200 };

		expect(sortRecHistoryBooks(books, 'newest', lastAt, {}, {}).map((b) => b.book_id)).toEqual([
			'tie',
			'new',
			'old'
		]);
		expect(sortRecHistoryBooks(books, 'oldest', lastAt, {}, {}).map((b) => b.book_id)).toEqual([
			'old',
			'tie',
			'new'
		]);
	});

	it('applies best-fit tie-breakers in count, rank, recency, title order', () => {
		const books = [book('recency', 'Zulu'), book('rank', 'Beta'), book('count', 'Alpha')];

		expect(
			sortRecHistoryBooks(
				books,
				'best-fit',
				{ recency: 300, rank: 100, count: 50 },
				{ recency: 2, rank: 2, count: 3 },
				{ recency: 2, rank: 1, count: 9 }
			).map((b) => b.book_id)
		).toEqual(['count', 'rank', 'recency']);

		expect(
			sortRecHistoryBooks(
				[book('z', 'Zulu'), book('a', 'Alpha')],
				'best-fit',
				{ z: 100, a: 100 },
				{ z: 1, a: 1 },
				{ z: 1, a: 1 }
			).map((b) => b.book_id)
		).toEqual(['a', 'z']);
	});
});
