import { describe, expect, it, vi } from 'vitest';
import { normalizeAwards, storedDistinctions } from './annotations';
import { mapBookRowToBook } from '$lib/search/mapBookRowToBook';
import { createRateFeedCache } from '$lib/feed/rateFeedCache';

const row = {
	id: 'uuid',
	book_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
	book_name: 'Book',
	author: 'Author',
	summary: null,
	year: null
};
const ranking = (rank: number, band: string | null) => ({
	rank,
	band,
	population_count: 1000,
	version: 'v1'
});

describe('stored book annotation mapping', () => {
	it('maps default tiers at their inclusive boundaries for both subjects', () => {
		for (const [rank, band, percent] of [
			[1, 'top_0_1_percent', 0.1],
			[10, 'top_1_percent', 1],
			[50, 'top_5_percent', 5],
			[100, 'top_10_percent', 10]
		] as const) {
			const result = storedDistinctions({
				book_ranking: { ...ranking(rank, band), series_title: 'Series' },
				author_ranking: ranking(rank, band)
			});
			expect(result.book).toMatchObject({ percent, subject: 'book', seriesTitle: 'Series' });
			expect(result.author).toMatchObject({ percent, subject: 'author' });
		}
	});
	it('omits unavailable, below-threshold, inconsistent, and malformed standings independently', () => {
		for (const invalid of [
			null,
			ranking(101, null),
			ranking(100, 'top_1_percent'),
			ranking(0, 'top_0_1_percent'),
			{ ...ranking(1, 'top_0_1_percent'), version: '' }
		]) {
			expect(
				storedDistinctions({ book_ranking: invalid, author_ranking: ranking(10, 'top_1_percent') })
			).toMatchObject({ book: null, author: { percent: 1 } });
		}
	});
	it('keeps valid optional fields and never uses the legacy band for a new badge', () => {
		const result = mapBookRowToBook({
			...row,
			quality_band: 'top_1_percent',
			book_ranking: null,
			author_ranking: null,
			pace_value: 0.8,
			depth_value: 2,
			atmosphere_value: null,
			keyword1: ' Wonder ',
			keyword2: null,
			keyword3: 'Wonder'
		} as Parameters<typeof mapBookRowToBook>[0]);
		expect(result.characteristics?.map((v) => v.label)).toEqual(['Introspective']);
		expect(result.keywords).toEqual(['Wonder']);
		expect(result.distinctions).toEqual({ book: null, author: null });
	});
	it('treats blank or absent title/author as a catalog error', () => {
		for (const broken of [
			{ book_name: null },
			{ book_name: ' ' },
			{ author: null },
			{ author: '' }
		]) {
			expect(() => mapBookRowToBook({ ...row, ...broken })).toThrow('Invalid catalog identity');
		}
	});
	it('sorts full award lists without deduplicating backend assignments', () => {
		const awards = [
			{ tier: 2, name: 'Second tier', status: 'winner', year: 2025 },
			{ tier: 1, name: 'Nomination', status: 'nominee', year: 2025 },
			{ tier: 1, name: 'Unknown year', status: 'winner', year: null },
			{ tier: 1, name: 'Earlier', status: 'winner', year: 2020 },
			{ tier: 1, name: 'Recent', status: 'winner', year: 2024 }
		];
		expect(normalizeAwards(awards).map((a) => a.name)).toEqual([
			'Recent',
			'Earlier',
			'Unknown year',
			'Nomination',
			'Second tier'
		]);
		expect(normalizeAwards([awards[0], awards[0]])).toHaveLength(2);
	});
	it('keeps valid awards alongside malformed entries and records a diagnostic', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const valid = { tier: 1, name: 'Award', status: 'winner', year: null };
			const result = mapBookRowToBook({
				...row,
				awards: [
					valid,
					{ ...valid, tier: 0 },
					{ ...valid, status: 'shortlist' },
					{ ...valid, year: 'unknown' }
				]
			});
			expect(result.awards).toEqual([valid]);
			expect(warn).toHaveBeenCalledWith('[catalog] Invalid optional award entries omitted', {
				bookId: row.book_id
			});
		} finally {
			warn.mockRestore();
		}
	});
	it('retains new metadata in feed snapshots without persisting the full award array', () => {
		const data = new Map<string, string>();
		const cache = createRateFeedCache({
			now: () => 1000,
			storage: () => ({
				getItem: (key) => data.get(key) ?? null,
				setItem: (key, value) => {
					data.set(key, value);
				},
				removeItem: (key) => {
					data.delete(key);
				}
			})
		});
		const book = mapBookRowToBook({
			...row,
			pace_value: 0.8,
			book_ranking: ranking(10, 'top_1_percent'),
			author_ranking: null,
			keyword1: 'Wonder'
		} as Parameters<typeof mapBookRowToBook>[0]);
		cache.write({
			version: 1,
			ownerId: 'reader',
			fetchedAt: 1000,
			source: { kind: 'curated', requestId: '42' },
			books: [
				{ ...book, awards: [{ tier: 1, name: 'Do not cache', status: 'winner', year: null }] }
			]
		});
		expect(cache.read('reader')?.books[0]).toEqual(JSON.parse(JSON.stringify(book)));
		expect([...data.values()][0]).not.toContain('Do not cache');
		expect(cache.read('another-reader')).toBeNull();
	});
});
