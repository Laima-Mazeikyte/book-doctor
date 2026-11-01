import { expect, it } from 'vitest';
import { bookSeries } from './series';

const id = (n: number) => `01${String(n).padStart(24, '0')}`;
it('orders decimal positions numerically, preserves disambiguated names and shared positions', () => {
	const series = bookSeries({
		title: 'Shared Name (Author)',
		number: 109,
		members: [
			{ book_id: id(4), slug: 'book-4', title: 'Ten', number: 10 },
			{ book_id: id(3), slug: 'book-3', title: 'Two', number: 2 },
			{ book_id: id(2), slug: 'book-2', title: 'Side story', number: 0.01 },
			{ book_id: id(1), slug: 'book-1', title: 'Another edition', number: 2 },
			{ book_id: id(5), slug: 'book-5', title: 'Beyond one hundred', number: 109 }
		]
	});
	expect(series?.title).toBe('Shared Name (Author)');
	expect(series?.number).toBe(109);
	expect(series?.members.map((m) => m.book_id)).toEqual([id(2), id(1), id(3), id(4), id(5)]);
});

it('omits missing or invalid membership and independently omits malformed optional roster entries', () => {
	for (const value of [
		null,
		undefined,
		{},
		{ title: 'NA', number: 1 },
		{ title: 'Series', number: '1' },
		{ title: 'Series', number: 0 },
		{ title: 'Series', number: Infinity },
		{ title: 'Series', number: NaN }
	])
		expect(bookSeries(value)).toBeNull();
	expect(
		bookSeries({
			title: 'Series',
			number: 1.5,
			members: [
				null,
				{ book_id: id(1), slug: 'book-1', title: 'Valid', number: 1.5 },
				{ book_id: 'invalid', title: 'Bad', number: 1 }
			]
		})?.members
	).toEqual([{ book_id: id(1), slug: 'book-1', title: 'Valid', number: 1.5 }]);
});
