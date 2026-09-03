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
	it('maps the authoritative band and percentile from a catalog row', () => {
		const book = mapBookRowToBook({
			...baseRow,
			quality_percentile: '96.42',
			quality_band: ' top_5_percent '
		});

		expect(book.qualityPercentile).toBe(96.42);
		expect(book.qualityBand).toBe('top_5_percent');
	});

	it('retains below-top-25 as a known non-visible band and preserves null evidence', () => {
		const below = mapBookRowToBook({
			...baseRow,
			quality_percentile: 72.15,
			quality_band: 'below_top_25'
		});
		const missing = mapBookRowToBook({
			...baseRow,
			quality_percentile: null,
			quality_band: null
		});

		expect(below.qualityPercentile).toBe(72.15);
		expect(below.qualityBand).toBe('below_top_25');
		expect(missing.qualityPercentile).toBeNull();
		expect(missing.qualityBand).toBeNull();
	});

	it('fails closed for an unexpected band value', () => {
		const book = mapBookRowToBook({
			...baseRow,
			quality_percentile: 99.99,
			quality_band: 'top_2_percent'
		});

		expect(book.qualityPercentile).toBe(99.99);
		expect(book.qualityBand).toBeNull();
	});
});
