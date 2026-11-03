import { describe, expect, it } from 'vitest';
import { createShelfSearch } from './shelfSearch';

const books = [
	{ id: 'hobbit', title: 'The Hobbit', author: 'J. R. R. Tolkien' },
	{ id: 'rings', title: 'The Lord of the Rings', author: 'J. R. R. Tolkien' },
	{ id: 'emma', title: 'Emma', author: 'Jane Austen' },
	{ id: 'solitude', title: 'Cien años de soledad', author: 'Gabriel García Márquez' },
	{ id: 'it', title: 'It', author: 'Stephen King' },
	{ id: 'dune', title: 'Dune', author: 'Frank Herbert' }
];
const search = createShelfSearch(books);
const ids = (query: string) => [...(search.matchingIds(query) ?? [])];

describe('shelf search', () => {
	it.each([
		['hobit', ['hobbit']],
		['hobbitt', ['hobbit']],
		['hobbet', ['hobbit']],
		['hobibt', ['hobbit']],
		['tolkein', ['hobbit', 'rings']],
		['emam', ['emma']],
		['ema', ['emma']]
	])('tolerates a small typo in %s', (query, expected) => {
		expect(ids(query)).toEqual(expected);
	});

	it('requires every query word, across title and author, in either order', () => {
		expect(ids('hobit tolkein')).toEqual(['hobbit']);
		expect(ids('TOLKEIN   hobit')).toEqual(['hobbit']);
		expect(ids('hobit austen')).toEqual([]);
		expect(ids('hobit somethingunrelated')).toEqual([]);
	});

	it('ignores accents, capitalization, punctuation, and surrounding whitespace', () => {
		expect(ids('  GARCIA MARQUEZ  ')).toEqual(['solitude']);
		expect(ids('anos soledad')).toEqual(['solitude']);
		expect(ids('J.R.R. Tolkien')).toEqual(['hobbit', 'rings']);
		expect(ids('Rings, Tolkien!')).toEqual(['rings']);
	});

	it('keeps one- and two-character query words literal, including inside longer queries', () => {
		expect(ids('it')).toEqual(['hobbit', 'it']);
		expect(ids('ix')).toEqual([]);
		expect(ids('z')).toEqual(['solitude']);
		expect(ids('ix king')).toEqual([]);
	});

	it('clears filtering for blank input, but not for punctuation-only input', () => {
		expect(search.matchingIds('')).toBeNull();
		expect(search.matchingIds('  \t ')).toBeNull();
		expect(ids('...')).toEqual([]);
	});

	it('rejects unrelated input and does not search summaries or genres', () => {
		const detailedBooks = [{ ...books[0], summary: 'Astronauts', genres: ['Space'] }];
		const index = createShelfSearch(detailedBooks);
		expect(index.matchingIds('astronauts')).toEqual(new Set());
		expect(index.matchingIds('space')).toEqual(new Set());
		expect(ids('qzxvbnm')).toEqual([]);
	});

	it('matches long titles and words near the end of long fields', () => {
		const title =
			'A Very Long Book Title About Travelling Through Forgotten Kingdoms and Finding Home';
		const index = createShelfSearch([{ id: 'long', title, author: 'Test Writer' }]);
		expect(index.matchingIds(title)).toEqual(new Set(['long']));
		expect(index.matchingIds('finding home')).toEqual(new Set(['long']));
	});

	it('returns membership without replacing the selected shelf order or mutating the query', () => {
		const query = '  TOLKEIN  ';
		const matches = search.matchingIds(query);
		const oldestFirst = [...books].reverse();
		expect(oldestFirst.filter((book) => matches?.has(book.id)).map((book) => book.id)).toEqual([
			'rings',
			'hobbit'
		]);
		expect(query).toBe('  TOLKEIN  ');
	});

	it('rebuilds from the new collection without retaining removed or other-account books', () => {
		const updated = createShelfSearch([
			books[1],
			{ id: 'added', title: 'The Silmarillion', author: 'J. R. R. Tolkien' }
		]);
		expect(updated.matchingIds('tolkein')).toEqual(new Set(['rings', 'added']));
		expect(createShelfSearch([]).matchingIds('tolkein')).toEqual(new Set());
	});
});
