import { afterEach, expect, it, vi } from 'vitest';
import { loadSelectionHistory } from './selectionHistory';
import type { SelectionRun } from './bookSelection';
import { SelectionJobError } from './selectionJob';

const book = { id: 'uuid', book_id: '01TEST', title: 'Saved book', author: 'Author' };
const run: SelectionRun = {
	public_id: 'SavedA1',
	request_type: 'rank_selection',
	book_ids: [book.book_id, 'missing'],
	status: 'completed',
	result_count: 1,
	error_code: null,
	created_at: '2026-11-01T12:00:00Z'
};
const payload = {
	books: [book],
	request_id: run.public_id,
	likedBookPrecedentsByBookId: {},
	authorRelationshipAuthorsByBookId: {},
	dimensionMatchSnapshotsByBookId: {}
};
function fixture() {
	const controller = new AbortController();
	return {
		controller,
		options: {
			id: run.public_id,
			signal: controller.signal,
			getRun: vi.fn().mockResolvedValue({ request: run, books: [book] }),
			loadResults: vi.fn().mockResolvedValue(payload)
		}
	};
}
afterEach(() => vi.useRealTimers());

it('loads inputs then ranked results without changing the submitted order or losing missing inputs', async () => {
	const { options } = fixture();
	const value = await loadSelectionHistory(options);
	expect(options.getRun).toHaveBeenCalledWith(run.public_id, true, expect.any(AbortSignal));
	expect(value.books.map((book) => book.book_id)).toEqual(run.book_ids);
	expect(value.books[1].title).toBe('Unavailable book');
	expect(value.result).toEqual(payload);
});

it('waits for genuinely processing saved runs without refetching input books each poll', async () => {
	vi.useFakeTimers();
	const { options } = fixture();
	options.getRun.mockResolvedValueOnce({
		request: { ...run, status: 'processing' },
		books: [book]
	});
	const pending = loadSelectionHistory(options);
	await vi.advanceTimersByTimeAsync(499);
	expect(options.loadResults).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect((await pending).books[0]).toEqual(book);
	expect(options.getRun).toHaveBeenNthCalledWith(2, run.public_id, false, expect.any(AbortSignal));
});

it('reports failed saved requests without loading results', async () => {
	const { options } = fixture();
	options.getRun.mockResolvedValue({ request: { ...run, status: 'failed', error_code: 'failed' } });
	await expect(loadSelectionHistory(options)).rejects.toBeInstanceOf(SelectionJobError);
	expect(options.loadResults).not.toHaveBeenCalled();
});

it('cancels a late response without starting result loading', async () => {
	const { options, controller } = fixture();
	let resolve!: (value: { request: SelectionRun }) => void;
	options.getRun.mockImplementation(
		() =>
			new Promise((done) => {
				resolve = done;
			})
	);
	const pending = loadSelectionHistory(options);
	const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	controller.abort();
	resolve({ request: run });
	await rejection;
	expect(options.loadResults).not.toHaveBeenCalled();
});

it('bounds the whole historical read, including result transport', async () => {
	vi.useFakeTimers();
	const { options } = fixture();
	options.loadResults.mockReturnValue(new Promise(() => {}));
	const pending = loadSelectionHistory(options);
	const rejection = expect(pending).rejects.toMatchObject({ name: 'RequestTimeoutError' });
	await vi.advanceTimersByTimeAsync(15_000);
	await rejection;
});
