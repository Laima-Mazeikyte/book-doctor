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

		expect(sortRecHistoryBooks(books, 'newest', lastAt).map((b) => b.book_id)).toEqual([
			'tie',
			'new',
			'old'
		]);
		expect(sortRecHistoryBooks(books, 'oldest', lastAt).map((b) => b.book_id)).toEqual([
			'old',
			'tie',
			'new'
		]);
	});

	it('rejects the removed best-fit preference', async () => {
		const { isValidRecSortId } = await import('./sortRecHistoryBooks');
		expect(isValidRecSortId('best-fit')).toBe(false);
		expect(isValidRecSortId('newest')).toBe(true);
	});
});
