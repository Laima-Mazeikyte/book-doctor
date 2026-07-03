import { describe, it, expect } from 'vitest';
import { buildMisses } from './runImport';
import type { GoodreadsRow } from './types';

const rows: GoodreadsRow[] = [
	{ goodreads_id: 13278990, rating: 5, title: 'The Housing Monster', author: 'prole.info' },
	{ goodreads_id: 7805, rating: 3, title: 'Pale Fire', author: 'Vladimir Nabokov' }
];

describe('buildMisses', () => {
	it('resolves title/author when the backend returns numeric ids', () => {
		expect(buildMisses(rows, [7805])).toEqual([
			{ goodreads_id: 7805, title: 'Pale Fire', author: 'Vladimir Nabokov' }
		]);
	});

	it('resolves title/author when the backend returns string ids', () => {
		expect(buildMisses(rows, ['7805'])).toEqual([
			{ goodreads_id: 7805, title: 'Pale Fire', author: 'Vladimir Nabokov' }
		]);
	});

	it('falls back to empty strings for an id not in the parsed rows', () => {
		expect(buildMisses(rows, [999999])).toEqual([{ goodreads_id: 999999, title: '', author: '' }]);
	});
});
