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

const SG_HEADER =
	'Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?';

function sgLine(title: string, authors: string, star: string, status = 'read'): string {
	// Columns: Title(0),Authors(1),...,Read Status(5),...,Star Rating(17),...
	return `${title},${authors},"",,audio,${status},2021/08/09,"","",1,"",,,,,,,${star},"","","","",No`;
}

describe('parseGoodreadsCsv (StoryGraph exports)', () => {
	it('parses StoryGraph rows with null id/year and metadata for matching', async () => {
		const csv = [SG_HEADER, sgLine('The Selfish Gene', 'Richard Dawkins', '4.75')].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows).toEqual([
			{ goodreads_id: null, rating: 5, title: 'The Selfish Gene', author: 'Richard Dawkins', year: null }
		]);
	});

	it('rounds fractional star ratings to the nearest 1-5, flooring low values to 1', async () => {
		const csv = [
			SG_HEADER,
			sgLine('A', 'Author A', '4.75'), // -> 5
			sgLine('B', 'Author B', '2.5'), // -> 3
			sgLine('C', 'Author C', '3'), // -> 3
			sgLine('D', 'Author D', '0.25'), // rounds to 0 -> clamped to 1
			sgLine('E', 'Author E', '0.5') // -> 1
		].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows.map((r) => r.rating)).toEqual([5, 3, 3, 1, 1]);
	});

	it('defaults a blank Star Rating to 1 for read books', async () => {
		const csv = [
			SG_HEADER,
			sgLine('Rated', 'Author A', '4'),
			sgLine('Unrated', 'Author B', '')
		].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows).toEqual([
			{ goodreads_id: null, rating: 4, title: 'Rated', author: 'Author A', year: null },
			{ goodreads_id: null, rating: 1, title: 'Unrated', author: 'Author B', year: null }
		]);
	});

	it('skips rows not marked "read" so shelves like to-read do not become 1-star', async () => {
		const csv = [
			SG_HEADER,
			sgLine('Finished', 'Author A', '', 'read'),
			sgLine('On the pile', 'Author B', '', 'to-read'),
			sgLine('Abandoned', 'Author C', '3', 'did-not-finish')
		].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows.map((r) => r.title)).toEqual(['Finished']);
	});
});

const HC_HEADER =
	'Title,Author,Series,Status,Privacy,Hardcover Book ID,Hardcover Edition ID,ISBN 10,ISBN 13,ASIN,Media,Country Code,Language Code,Binding,Pages,Duration in Seconds,Publish Date,Publisher,Genres,Moods,Tags,Content Warnings,Lists,Date Added,Date Started,Date Finished,Rating,Review,Review Contains Spoilers,Sponsored Review,Review Date,Review URL,Review Media URL,Private Notes,Owned,Compilation,Review Slate';

function hcLine(title: string, author: string, rating: string, status = 'Read'): string {
	// Columns: Title(0),Author(1),Series(2),Status(3),...,Publish Date(16),...,Rating(26),...
	return `${title},${author},,${status},Public,379760,29258002,0141036141,9780141036144,,Book,gb,en,,336,,2008-07-03,Penguin Books,,,,,"",2026-03-12,"","",${rating},,false,false,,,,,false,No,{}`;
}

describe('parseGoodreadsCsv (Hardcover exports)', () => {
	it('parses Hardcover rows with null id/year and rounded rating', async () => {
		const csv = [
			HC_HEADER,
			hcLine('1984', 'George Orwell', '5.0'),
			hcLine('Project Hail Mary', 'Andy Weir', '3.0')
		].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows).toEqual([
			{ goodreads_id: null, rating: 5, title: '1984', author: 'George Orwell', year: null },
			{ goodreads_id: null, rating: 3, title: 'Project Hail Mary', author: 'Andy Weir', year: null }
		]);
	});

	it('defaults a blank Rating to 1 for read books', async () => {
		const csv = [HC_HEADER, hcLine('No Stars', 'Some Author', '')].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows).toEqual([
			{ goodreads_id: null, rating: 1, title: 'No Stars', author: 'Some Author', year: null }
		]);
	});

	it('skips Hardcover rows not marked "Read"', async () => {
		const csv = [
			HC_HEADER,
			hcLine('Finished', 'Author A', '4.0', 'Read'),
			hcLine('Someday', 'Author B', '', 'Want to Read'),
			hcLine('Reading Now', 'Author C', '', 'Currently Reading')
		].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows.map((r) => r.title)).toEqual(['Finished']);
	});
});

describe('parseGoodreadsCsv (custom user CSV)', () => {
	it('parses a custom CSV with Title, Author, Rating and optional Year', async () => {
		const csv = ['Title,Author,Rating,Year', 'Dune,Frank Herbert,5,1965'].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows).toEqual([
			{ goodreads_id: null, rating: 5, title: 'Dune', author: 'Frank Herbert', year: 1965 }
		]);
	});

	it('matches headers case-insensitively and accepts Authors (plural)', async () => {
		const csv = ['title,authors,rating', 'Neuromancer,William Gibson,4'].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows).toEqual([
			{ goodreads_id: null, rating: 4, title: 'Neuromancer', author: 'William Gibson', year: null }
		]);
	});

	it('leaves year null when there is no Year column', async () => {
		const csv = ['Title,Author,Rating', 'Snow Crash,Neal Stephenson,3'].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows[0].year).toBeNull();
	});

	it('skips rows missing a rating or missing title/author', async () => {
		const csv = [
			'Title,Author,Rating',
			'Rated,Author A,4',
			'No Rating,Author B,', // blank rating -> skipped
			',Author C,5', // no title -> skipped
			'No Author,,5' // no author -> skipped
		].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		expect(rows.map((r) => r.title)).toEqual(['Rated']);
	});

	it('rejects a CSV without a Rating column as not_export', async () => {
		const csv = ['Title,Author', 'Just a List,Someone'].join('\n');

		await expect(parseGoodreadsCsv(csv)).rejects.toBeInstanceOf(GoodreadsCsvError);
	});

	it('still routes a real Goodreads file to the Goodreads mapper (not custom)', async () => {
		const csv = [HEADER, line('12345', 'Goodreads Book', 'Real Author', '5', '1999')].join('\n');

		const { rows } = await parseGoodreadsCsv(csv);

		// Custom would have flattened goodreads_id to null; Goodreads mapper keeps it + year.
		expect(rows).toEqual([
			{
				goodreads_id: 12345,
				rating: 5,
				title: 'Goodreads Book',
				author: 'Real Author',
				year: 1999
			}
		]);
	});
});
