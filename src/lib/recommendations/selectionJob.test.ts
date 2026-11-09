import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	runSelectionJob,
	selectionResultBooks,
	SelectionJobError,
	RequestTimeoutError
} from './selectionJob';
import type { SelectionPending, SelectionRun } from './bookSelection';
import type { FetchRecommendationsResult } from './fetchRecommendations';
import type { Book } from '$lib/types/book';

const books: Book[] = Array.from({ length: 12 }, (_, i) => ({
	id: `uuid-${i}`,
	book_id: `01${String(i).padStart(24, '0')}`,
	title: ['Zulu', 'Alpha', 'Beta', 'Gamma'][i] ?? `Book ${i}`,
	author: 'Author'
}));
const run = (changes: Partial<SelectionRun> = {}): SelectionRun => ({
	public_id: 'ChooseA1',
	request_type: 'rank_selection',
	book_ids: books.slice(0, 4).map((book) => book.book_id),
	status: 'processing',
	result_count: null,
	error_code: null,
	created_at: new Date().toISOString(),
	...changes
});
const result = (selected = books.slice(0, 4)): FetchRecommendationsResult => ({
	books: selected,
	request_id: 'ChooseA1',
	likedBookPrecedentsByBookId: {},
	authorRelationshipAuthorsByBookId: {},
	dimensionMatchSnapshotsByBookId: {}
});
function fixture(changes: Partial<SelectionPending> = {}) {
	const controller = new AbortController();
	const options = {
		pending: { ...run(), since: Date.now(), ...changes } as SelectionPending,
		signal: controller.signal,
		getStatus: vi.fn().mockResolvedValue(run()),
		getRecent: vi.fn().mockResolvedValue([]),
		loadResults: vi.fn().mockResolvedValue(result()),
		onPending: vi.fn(),
		onRun: vi.fn(),
		onRecovering: vi.fn()
	};
	return { options, controller };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('selection job lifecycle', () => {
	it('checks immediately and then every 500ms, fetching results only after completion', async () => {
		const { options } = fixture();
		options.getStatus
			.mockResolvedValueOnce(run())
			.mockResolvedValueOnce(run({ status: 'completed', result_count: 4 }));
		const job = runSelectionJob(options);
		await vi.advanceTimersByTimeAsync(0);
		expect(options.getStatus).toHaveBeenCalledTimes(1);
		expect(options.loadResults).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(499);
		expect(options.getStatus).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect((await job).result.books).toHaveLength(4);
		expect(options.getStatus).toHaveBeenCalledTimes(2);
		expect(options.loadResults).toHaveBeenCalledTimes(1);
	});
	it('never overlaps slow status checks', async () => {
		const { options, controller } = fixture();
		let release!: (value: SelectionRun) => void;
		options.getStatus.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		const job = runSelectionJob(options);
		const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
		await vi.advanceTimersByTimeAsync(1700);
		expect(options.getStatus).toHaveBeenCalledTimes(1);
		release(run());
		await vi.advanceTimersByTimeAsync(499);
		expect(options.getStatus).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(options.getStatus).toHaveBeenCalledTimes(2);
		controller.abort();
		await rejected;
	});
	it('uses the original deadline on resume, including results loading', async () => {
		const { options } = fixture({ since: Date.now() - 8000 });
		options.getStatus.mockResolvedValue(run({ status: 'completed', result_count: 4 }));
		options.loadResults.mockReturnValue(new Promise(() => {}));
		const job = runSelectionJob(options);
		const rejected = expect(job).rejects.toBeInstanceOf(RequestTimeoutError);
		await vi.advanceTimersByTimeAsync(2000);
		await rejected;
		expect(options.loadResults).toHaveBeenCalledTimes(1);
	});
	it('does not reset an expired deadline or start any reads', async () => {
		const { options } = fixture({ since: Date.now() - 10_000 });
		await expect(runSelectionJob(options)).rejects.toBeInstanceOf(RequestTimeoutError);
		expect(options.getStatus).not.toHaveBeenCalled();
	});
	it('recovers an uncertain submission without a second POST and excludes older attempts', async () => {
		const { options } = fixture({ public_id: undefined, excluded_ids: ['OldRunA1'] });
		const submit = vi.fn().mockRejectedValue(new TypeError('Network unavailable'));
		options.getRecent.mockResolvedValue([run({ public_id: 'OldRunA1' }), run()]);
		options.getStatus.mockResolvedValue(run({ status: 'completed', result_count: 4 }));
		const completed = await runSelectionJob({ ...options, submit });
		expect(completed.run.public_id).toBe('ChooseA1');
		expect(submit).toHaveBeenCalledTimes(1);
		expect(options.getStatus).toHaveBeenCalledWith('ChooseA1', expect.any(AbortSignal));
		expect(options.onPending).toHaveBeenCalledWith(
			expect.objectContaining({ public_id: 'ChooseA1' })
		);
	});
	it('backs off network errors and returns to 500ms after a successful check', async () => {
		const { options, controller } = fixture();
		options.getStatus.mockRejectedValueOnce(new TypeError('Offline'));
		const job = runSelectionJob(options);
		const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
		await vi.advanceTimersByTimeAsync(999);
		expect(options.getStatus).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(options.getStatus).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(500);
		expect(options.getStatus).toHaveBeenCalledTimes(3);
		controller.abort();
		await rejected;
	});
	it('checks immediately on visibility without overlapping an in-flight check', async () => {
		const target = Object.assign(new EventTarget(), { visibilityState: 'visible' });
		const { options, controller } = fixture();
		const job = runSelectionJob({ ...options, visibilityTarget: target as unknown as Document });
		const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
		await vi.advanceTimersByTimeAsync(100);
		target.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(options.getStatus).toHaveBeenCalledTimes(2);
		controller.abort();
		await rejected;
	});
	it('queues a visibility check until the current status request finishes', async () => {
		const target = Object.assign(new EventTarget(), { visibilityState: 'visible' });
		const { options, controller } = fixture();
		let release!: (value: SelectionRun) => void;
		options.getStatus.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		const job = runSelectionJob({ ...options, visibilityTarget: target as unknown as Document });
		const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
		await vi.advanceTimersByTimeAsync(100);
		target.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(100);
		expect(options.getStatus).toHaveBeenCalledTimes(1);
		release(run());
		await vi.advanceTimersByTimeAsync(0);
		expect(options.getStatus).toHaveBeenCalledTimes(2);
		controller.abort();
		await rejected;
	});
	it('keeps checking hidden tabs and uses exponential backoff capped at four seconds', async () => {
		const target = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
		const { options, controller } = fixture();
		options.getStatus.mockRejectedValue(new TypeError('Offline'));
		const job = runSelectionJob({ ...options, visibilityTarget: target as unknown as Document });
		const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
		await vi.advanceTimersByTimeAsync(1000);
		expect(options.getStatus).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(2000);
		expect(options.getStatus).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(4000);
		expect(options.getStatus).toHaveBeenCalledTimes(4);
		controller.abort();
		await rejected;
	});
	it('ignores a late status response after navigation aborts the job', async () => {
		const { options, controller } = fixture();
		let release!: (value: SelectionRun) => void;
		options.getStatus.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		const job = runSelectionJob(options);
		const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
		await vi.advanceTimersByTimeAsync(0);
		controller.abort();
		await rejected;
		release(run({ status: 'completed', result_count: 4 }));
		await vi.advanceTimersByTimeAsync(0);
		expect(options.onRun).not.toHaveBeenCalled();
		expect(options.loadResults).not.toHaveBeenCalled();
	});
	it('treats confirmed failures and entirely skipped inputs as failures, never successes', async () => {
		for (const status of ['failed', 'completed']) {
			const { options } = fixture();
			options.getStatus.mockResolvedValue(
				run({ status, error_code: 'no_usable_selection', skipped_book_ids: run().book_ids })
			);
			await expect(runSelectionJob(options)).rejects.toBeInstanceOf(SelectionJobError);
			expect(options.loadResults).not.toHaveBeenCalled();
		}
	});
	it('does not recover or poll a confirmed submission rejection', async () => {
		const { options } = fixture({ public_id: undefined });
		const error = Object.assign(new Error('Rejected'), { notStarted: true });
		await expect(
			runSelectionJob({
				...options,
				submit: async () => {
					throw error;
				}
			})
		).rejects.toBe(error);
		expect(options.getRecent).not.toHaveBeenCalled();
	});
});

describe('selection result order', () => {
	it('silently appends skipped inputs alphabetically for 4–9 book rankings', () => {
		const ranked = [books[3], books[2]];
		const completed = run({
			result_count: 2,
			skipped_book_ids: [books[0].book_id, books[1].book_id]
		});
		expect(selectionResultBooks(completed, result(ranked), books.slice(0, 4))).toEqual([
			books[3],
			books[2],
			books[1],
			books[0]
		]);
		expect(ranked).toEqual([books[3], books[2]]);
	});
	it('does not append skipped inputs for 10+ books, inspiration or empty results', () => {
		for (const changes of [
			{ book_ids: books.slice(0, 10).map((book) => book.book_id) },
			{ book_ids: books.map((book) => book.book_id) },
			{ request_type: 'recommend_from_selection' as const }
		]) {
			const completed = run({ ...changes, result_count: 1, skipped_book_ids: [books[1].book_id] });
			expect(selectionResultBooks(completed, result([books[0]]), books)).toEqual([books[0]]);
		}
		expect(
			selectionResultBooks(
				run({ result_count: 0, skipped_book_ids: run().book_ids }),
				result([]),
				books
			)
		).toEqual([]);
	});
});
