import { describe, it, expect, vi } from 'vitest';
import { buildMisses, runGoodreadsImport } from './runImport';
import { createImportJob, pollImportJob } from './importJobs';
import type { GoodreadsRow } from './types';

vi.mock('./importJobs', () => ({ createImportJob: vi.fn(), pollImportJob: vi.fn() }));

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

it('retains a confirmed import job after a status-read failure and checks it without inserting again', async () => {
	vi.mocked(createImportJob).mockResolvedValue({ id: 'confirmed-job', error: null });
	vi.mocked(pollImportJob)
		.mockResolvedValueOnce({ status: 'failed', error: new Error('Status unavailable') })
		.mockResolvedValueOnce({
			status: 'done',
			result: { status: 'done', matched_count: 3, unmatched: [], error: null }
		});
	const first = await runGoodreadsImport('reader', rows);
	expect(first).toEqual({ kind: 'timeout', jobId: 'confirmed-job' });
	if (first.kind !== 'timeout') throw new Error('Expected recoverable observation failure');
	await expect(runGoodreadsImport('reader', rows, undefined, first.jobId)).resolves.toEqual({
		kind: 'done',
		imported: 3,
		misses: []
	});
	expect(createImportJob).toHaveBeenCalledOnce();
	expect(pollImportJob).toHaveBeenLastCalledWith('confirmed-job', undefined);
});

it('reports a terminal backend import failure separately from a failed status read', async () => {
	vi.mocked(pollImportJob).mockResolvedValueOnce({
		status: 'error',
		result: { status: 'error', matched_count: 0, unmatched: [], error: 'Invalid import' }
	});
	await expect(runGoodreadsImport('reader', rows, undefined, 'failed-job')).resolves.toEqual({
		kind: 'error'
	});
});
