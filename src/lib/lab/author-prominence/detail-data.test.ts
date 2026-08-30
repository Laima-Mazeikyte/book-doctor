import { describe, expect, it, vi } from 'vitest';
import { AuthorDetailRepository, detailShardForAuthor, validateDetailShard } from './detail-data';
import type { ProminenceManifest } from './types';

const details = {
	schema_version: 1,
	author_count: 3,
	shard_size: 2,
	shard_count: 2,
	index_base: 0,
	path_pattern: 'details/{shard}.json',
	book_limit: 4,
	recognition_record_limit: 5,
	peak_method: 'grid_1pct',
	peak_weight_quantum: 0.01,
	generated_utc: '2026-08-29T00:00:00Z'
};

const manifest = {
	details,
	model: { features: ['regard', 'reach', 'recognition'] }
} as unknown as ProminenceManifest;

const bookId = '01KR2ADTNG29NSQV23VAGV8FXB';

function row(index = 0): unknown[] {
	return [
		index + 1,
		[0.6, 0.4, 0],
		[1922, 1926],
		['Literary Fiction', 'Fantasy'],
		[[bookId, 'A book']],
		[[3, [['A book', 'A prize', 2020, 'win']]]]
	];
}

function payload(rows: unknown[][] = [row()]): Record<string, unknown> {
	return {
		schema_version: 1,
		start: 0,
		columns: ['peak_rank', 'peak_weights', 'catalogue_years', 'genres', 'books', 'recognition'],
		rows
	};
}

describe('author prominence detail shards', () => {
	it('calculates first, boundary, and final shard addresses from population indices', () => {
		expect(detailShardForAuthor(0, details)).toBe(0);
		expect(detailShardForAuthor(1, details)).toBe(0);
		expect(detailShardForAuthor(2, details)).toBe(1);
		expect(() => detailShardForAuthor(3, details)).toThrow();
	});

	it('normalizes named detail fields and joins rows by shard start', () => {
		const normalized = validateDetailShard(payload([row(0), row(1)]), manifest, 0);
		expect(normalized.rows[0]).toMatchObject({
			populationIndex: 0,
			peakRank: 1,
			books: [{ bookUlid: bookId, title: 'A book' }],
			recognition: [
				{ workTitle: 'A book', awardName: 'A prize', year: 2020, status: 'win', tier: 3 }
			]
		});
		expect(normalized.rows[1].populationIndex).toBe(1);
	});

	it('rejects incorrect starts, columns, row counts, weights, books, years, genres, and receipts', () => {
		const cases = [
			{ ...payload(), start: 1 },
			{ ...payload(), columns: ['peak_rank'] },
			payload([]),
			payload([row(), row(), row()]),
			payload([[2, [0.7, 0.7, 0], [1922, 1926], ['Fantasy'], [[bookId, 'A book']], []]]),
			payload([[2, [1, 0, 0], [1926, 1922], ['Fantasy'], [[bookId, 'A book']], []]]),
			payload([[2, [1, 0, 0], null, ['a', 'b', 'c'], [[bookId, 'A book']], []]]),
			payload([[2, [1, 0, 0], null, ['Fantasy'], [['not-a-ulid', 'A book']], []]]),
			payload([
				[
					2,
					[1, 0, 0],
					null,
					['Fantasy'],
					[
						[bookId, 'A book'],
						[bookId, 'A book']
					],
					[]
				]
			]),
			payload([[2, [1, 0, 0], null, ['Fantasy'], [[bookId, 'A book']], [[6, []]]]]),
			payload([
				[
					2,
					[1, 0, 0],
					null,
					['Fantasy'],
					[[bookId, 'A book']],
					[[1, [['A book', 'Prize', '2020', 'win']]]]
				]
			])
		];
		for (const invalid of cases) expect(() => validateDetailShard(invalid, manifest, 0)).toThrow();
	});

	it('shares an in-flight shard and evicts failed requests for retry', async () => {
		const valid = payload([row(), row()]);
		const final = { ...valid, start: 2, rows: [row(2)] };
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce({ ok: true, json: async () => valid } as Response)
			.mockResolvedValueOnce({ ok: false, status: 503 } as Response)
			.mockResolvedValueOnce({ ok: true, json: async () => final } as Response);
		const repository = new AuthorDetailRepository({
			base: 'https://storage.example/author-prominence',
			webRoot: 'versions/v3/web',
			manifest,
			populationCount: 3
		});
		const first = repository.getShard(0);
		expect(repository.getShard(0)).toBe(first);
		expect((await repository.getAuthorDetail(0)).populationIndex).toBe(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await expect(repository.getShard(1)).rejects.toThrow();
		await expect(repository.getShard(1)).resolves.toBeTruthy();
		expect(fetchMock).toHaveBeenCalledTimes(3);
		fetchMock.mockRestore();
	});
});
