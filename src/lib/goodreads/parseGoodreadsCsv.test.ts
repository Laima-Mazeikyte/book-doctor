import { describe, it, expect } from 'vitest';
import { parseGoodreadsCsv, GoodreadsCsvError } from './parseGoodreadsCsv';

const HEADER =
	'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Recommended For,Recommended By,Owned Copies,Original Purchase Date,Original Purchase Location,Condition,Condition Description,BCID';

function line(bookId: string, title: string, author: string, rating: string): string {
	// Columns up to and including "My Rating" (index 7); the rest are irrelevant here.
	return `${bookId},${title},${author},"",,"","",${rating},3.77,,,,,,,2017/12/07,,,,,,,1,,,0,,,,,`;
}

describe('parseGoodreadsCsv', () => {
	it('keeps only rows rated 1-5 and retains title/author', async () => {
		const csv = [
			HEADER,
			line('111', 'Rated Book', 'Jane Doe', '4'),
			line('222', 'Unrated Book', 'John Roe', '0')
		].join('\n');

		const { rows, totalDataRows } = await parseGoodreadsCsv(csv);

		expect(totalDataRows).toBe(2);
		expect(rows).toEqual([
			{ goodreads_id: 111, rating: 4, title: 'Rated Book', author: 'Jane Doe' }
		]);
	});

	it('handles quoted commas in titles and authors', async () => {
		const csv = [HEADER, line('333', '"Book, A Novel"', '"Doe, Jane"', '5')].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows[0]).toEqual({
			goodreads_id: 333,
			rating: 5,
			title: 'Book, A Novel',
			author: 'Doe, Jane'
		});
	});

	it('rejects files that are not Goodreads exports', async () => {
		await expect(parseGoodreadsCsv('foo,bar\n1,2')).rejects.toBeInstanceOf(GoodreadsCsvError);
	});

	it('rejects non-integer Book Id / rating instead of coercing', async () => {
		const csv = [
			HEADER,
			line('123abc', 'Sloppy Id', 'Someone', '4'), // "123abc" must NOT become 123
			line('444', 'Sloppy Rating', 'Someone', '4.5') // "4.5" must NOT become 4
		].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows).toEqual([]);
	});

	it('strips control/bidi chars and caps display length', async () => {
		const bidiTitle = '‮Reversed‬';
		const longAuthor = 'a'.repeat(500);
		const csv = [HEADER, line('555', `"${bidiTitle}"`, `"${longAuthor}"`, '5')].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows[0].title).toBe('Reversed');
		expect(rows[0].author.length).toBe(201); // 200 chars + ellipsis
		expect(rows[0].author.endsWith('…')).toBe(true);
	});
});
