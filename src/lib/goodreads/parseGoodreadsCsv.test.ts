import { describe, it, expect } from 'vitest';
import { parseGoodreadsCsv, GoodreadsCsvError } from './parseGoodreadsCsv';

const HEADER =
	'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Recommended For,Recommended By,Owned Copies,Original Purchase Date,Original Purchase Location,Condition,Condition Description,BCID';

// Column layout: Book Id(0),Title(1),Author(2),...,My Rating(7),...,
// Year Published(12),Original Publication Year(13),...
function line(
	bookId: string,
	title: string,
	author: string,
	rating: string,
	origYear = ''
): string {
	return `${bookId},${title},${author},"",,"","",${rating},3.77,,,,,${origYear},,2017/12/07,,,,,,,1,,,0,,,,,`;
}

describe('parseGoodreadsCsv', () => {
	it('keeps only rows rated 1-5 and retains title/author/year', async () => {
		const csv = [
			HEADER,
			line('111', 'Rated Book', 'Jane Doe', '4', '1998'),
			line('222', 'Unrated Book', 'John Roe', '0')
		].join('\n');

		const { rows, totalDataRows } = await parseGoodreadsCsv(csv);

		expect(totalDataRows).toBe(2);
		expect(rows).toEqual([
			{ goodreads_id: 111, rating: 4, title: 'Rated Book', author: 'Jane Doe', year: 1998 }
		]);
	});

	it('passes NA (null) year when Original Publication Year is blank or unparseable', async () => {
		const csv = [
			HEADER,
			line('111', 'No Year', 'Jane Doe', '4', ''),
			line('222', 'Junk Year', 'John Roe', '5', 'n/a')
		].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows.map((r) => r.year)).toEqual([null, null]);
	});

	it('keeps a row with no Book Id when it has title + author', async () => {
		const csv = [HEADER, line('', 'Orphan Title', 'Some Author', '4', '2001')].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows).toEqual([
			{ goodreads_id: null, rating: 4, title: 'Orphan Title', author: 'Some Author', year: 2001 }
		]);
	});

	it('drops a row with neither Book Id nor title+author', async () => {
		const csv = [
			HEADER,
			line('', '', 'Lonely Author', '4'), // author only
			line('', 'Lonely Title', '', '4') // title only
		].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows).toEqual([]);
	});

	it('handles quoted commas in titles and authors', async () => {
		const csv = [HEADER, line('333', '"Book, A Novel"', '"Doe, Jane"', '5')].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows[0]).toEqual({
			goodreads_id: 333,
			rating: 5,
			title: 'Book, A Novel',
			author: 'Doe, Jane',
			year: null
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

		// Sloppy rating drops entirely; sloppy id keeps the row but with a null
		// goodreads_id (not coerced to 123) so it can still be metadata-matched.
		expect(rows).toEqual([
			{ goodreads_id: null, rating: 4, title: 'Sloppy Id', author: 'Someone', year: null }
		]);
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
