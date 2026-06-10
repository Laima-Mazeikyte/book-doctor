import { describe, expect, it } from 'vitest';
import { sectionVisible } from './shortlist-meta';
import type { Book } from '$lib/types/book';

const baseBook: Book = {
	id: '1',
	book_id: 'b1',
	title: 'Test',
	author: 'Author'
};

describe('sectionVisible', () => {
	it('shows type when book.type is set', () => {
		expect(sectionVisible({ kind: 'type' }, { ...baseBook, type: 'Fiction' })).toBe(true);
	});

	it('hides type when empty', () => {
		expect(sectionVisible({ kind: 'type' }, baseBook)).toBe(false);
	});

	it('shows genres when present', () => {
		expect(sectionVisible({ kind: 'genres' }, { ...baseBook, genres: ['Sci-Fi'] })).toBe(true);
	});
});
