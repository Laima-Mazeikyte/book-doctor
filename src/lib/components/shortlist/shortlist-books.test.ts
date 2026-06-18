import { describe, expect, it } from 'vitest';
import type { Book } from '$lib/types/book';
import {
	overlayForDismissedBook,
	insertBookAfterIndex,
	splitShortlistBooks,
	SHORTLIST_VISIBLE_COUNT
} from './shortlist-books';

function book(n: number): Book {
	return {
		id: `id-${n}`,
		book_id: `bid-${n}`,
		title: `Book ${n}`,
		author: 'Author'
	};
}

describe('shortlist-books', () => {
	it('splits into 7 visible and rest in reserve', () => {
		const all = Array.from({ length: 10 }, (_, i) => book(i));
		const { visible, reserve } = splitShortlistBooks(all);
		expect(visible).toHaveLength(SHORTLIST_VISIBLE_COUNT);
		expect(reserve).toHaveLength(3);
		expect(visible[0]?.id).toBe('id-0');
		expect(reserve[0]?.id).toBe('id-7');
	});

	it('puts all books in visible when fewer than 8', () => {
		const all = Array.from({ length: 5 }, (_, i) => book(i));
		const { visible, reserve } = splitShortlistBooks(all);
		expect(visible).toHaveLength(5);
		expect(reserve).toHaveLength(0);
	});

	it('inserts after index from reserve queue', () => {
		const visible = Array.from({ length: 7 }, (_, i) => book(i));
		const reserve = [book(7), book(8)];
		const result = insertBookAfterIndex(visible, 2, reserve);
		expect(result.incoming?.id).toBe('id-7');
		expect(result.visible).toHaveLength(8);
		expect(result.visible[2]?.id).toBe('id-2');
		expect(result.visible[3]?.id).toBe('id-7');
		expect(result.reserve).toHaveLength(1);
		expect(result.reserve[0]?.id).toBe('id-8');
	});

	it('does not insert when reserve is empty', () => {
		const visible = [book(0)];
		const result = insertBookAfterIndex(visible, 0, []);
		expect(result.incoming).toBeNull();
		expect(result.visible).toBe(visible);
	});

	describe('overlayForDismissedBook', () => {
		it('returns null when not dismissed', () => {
			expect(overlayForDismissedBook(undefined, 3, 0, 0)).toBeNull();
		});

		it('returns replace while under insertion limit with reserve', () => {
			expect(overlayForDismissedBook(1, 3, 0, 1)).toBe('replace');
			expect(overlayForDismissedBook(2, 1, 1, 2)).toBe('replace');
		});

		it('returns new-rec after two insertions', () => {
			expect(overlayForDismissedBook(1, 3, 2, 1)).toBe('new-rec');
		});

		it('returns new-rec on third not-interested', () => {
			expect(overlayForDismissedBook(3, 3, 0, 3)).toBe('new-rec');
			expect(overlayForDismissedBook(1, 3, 0, 3)).toBe('new-rec');
		});

		it('falls back to new-rec when reserve is empty and insertions exhausted', () => {
			expect(overlayForDismissedBook(1, 0, 2, 1)).toBe('new-rec');
		});
	});
});
