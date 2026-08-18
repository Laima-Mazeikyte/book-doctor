import { describe, expect, it } from 'vitest';
import { buildAuthorSearchIndex, searchAuthors } from './search';

describe('author prominence search', () => {
	const names = [
		'Stephen King',
		'Kingsley Amis',
		'Hocking',
		'Tarkington',
		'Émile Zola',
		"O'Connor, Flannery"
	];
	const index = buildAuthorSearchIndex(names);
	const ranks = Int32Array.from([77, 1642, 88, 102, 500, 610]);

	it('keeps display spelling while indexing a diacritic-free form', () => {
		expect(index[4]?.full).toBe('émile zola');
		expect(index[4]?.diacriticFree).toBe('emile zola');
	});

	it('returns actual King tokens and ranks them by relevance', () => {
		const matches = searchAuthors(index, 'king', ranks, 8);
		expect(matches).toContain(0);
		expect(matches.indexOf(0)).toBeLessThan(
			matches.indexOf(2) === -1 ? Infinity : matches.indexOf(2)
		);
	});

	it('normalizes accents, punctuation and whitespace', () => {
		expect(searchAuthors(index, '  emile   zola ', ranks, 8)[0]).toBe(4);
		expect(searchAuthors(index, 'oconnor', ranks, 8)[0]).toBe(5);
	});
});
