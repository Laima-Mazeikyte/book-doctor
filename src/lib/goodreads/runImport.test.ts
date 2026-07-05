import { describe, it, expect } from 'vitest';
import { buildMisses } from './runImport';
import type { GoodreadsRow } from './types';

const rows: GoodreadsRow[] = [
	{
		goodreads_id: 13278990,
		rating: 5,
		title: 'The Housing Monster',
		author: 'prole.info',
		year: 2012
	},
	{ goodreads_id: 7805, rating: 3, title: 'Pale Fire', author: 'Vladimir Nabokov', year: 1962 },
	{ goodreads_id: null, rating: 4, title: 'No Id Book', author: 'Anon', year: null }
];

describe('buildMisses', () => {
	it('resolves title/author from a numeric row index', () => {
		expect(buildMisses(rows, [1])).toEqual([
			{ index: 1, title: 'Pale Fire', author: 'Vladimir Nabokov' }
		]);
	});

	it('resolves title/author from a string index', () => {
		expect(buildMisses(rows, ['1'])).toEqual([
			{ index: 1, title: 'Pale Fire', author: 'Vladimir Nabokov' }
		]);
	});

	it('resolves rows that have no goodreads_id', () => {
		expect(buildMisses(rows, [2])).toEqual([{ index: 2, title: 'No Id Book', author: 'Anon' }]);
	});

	it('skips an index outside the parsed rows', () => {
		expect(buildMisses(rows, [0, 999])).toEqual([
			{ index: 0, title: 'The Housing Monster', author: 'prole.info' }
		]);
	});
});
