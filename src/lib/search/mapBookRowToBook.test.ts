import { describe, expect, it } from 'vitest';
import { mapBookRowToBook, type BookCatalogRow } from './mapBookRowToBook';

const baseRow: BookCatalogRow = {
	id: 'uuid-book',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	book_name: 'A book',
	author: 'An author',
	summary: null,
	year: null
};

describe('mapBookRowToBook quality evidence', () => {
	it('maps the authoritative band from a catalog row', () => {
		const book = mapBookRowToBook({
			...baseRow,
			quality_band: ' top_5_percent '
		});

		expect(book.qualityBand).toBe('top_5_percent');
	});

	it('retains below-top-25 as a known non-visible band and preserves null evidence', () => {
		const below = mapBookRowToBook({
			...baseRow,
			quality_band: 'below_top_25'
		});
		const missing = mapBookRowToBook({
			...baseRow,
			quality_band: null
		});

		expect(below.qualityBand).toBe('below_top_25');
		expect(missing.qualityBand).toBeNull();
	});

	it('fails closed for an unexpected band value', () => {
		const book = mapBookRowToBook({
			...baseRow,
			quality_band: 'top_2_percent'
		});

		expect(book.qualityBand).toBeNull();
	});
});
