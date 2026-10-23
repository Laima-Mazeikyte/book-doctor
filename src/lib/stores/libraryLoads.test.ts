import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibraryLoadController } from './libraryLoads';

describe('library reads', () => {
	let reads: ReturnType<typeof createLibraryLoadController>;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		reads = createLibraryLoadController(100);
	});
	afterEach(() => {
		reads.reset();
		vi.useRealTimers();
	});

	it('retries after 1, 2, and 5 seconds, then waits for Retry or a new visit', async () => {
		const times: number[] = [];
		let works = false;
		const commit = vi.fn();
		reads.register(
			'A',
			'ratings',
			async () => {
				times.push(Date.now());
				if (!works) throw new Error('offline');
				return commit;
			},
			1,
			() => true
		);
		const loading = reads.load('ratings');
		await vi.advanceTimersByTimeAsync(8000);
		await loading;
		expect(times).toEqual([0, 1000, 3000, 8000]);
		expect(get(reads).collections.ratings).toMatchObject({ status: 'error', hasSnapshot: false });
		await vi.advanceTimersByTimeAsync(60_000);
		await reads.load('ratings');
		expect(times).toHaveLength(4);
		works = true;
		await reads.visit(['ratings']);
		expect(commit).toHaveBeenCalledOnce();
		expect(get(reads).collections.ratings).toMatchObject({ status: 'ready', hasSnapshot: true });
	});

	it('keeps successful collections usable while another collection fails', async () => {
		const ratingCommit = vi.fn();
		reads.register(
			'A',
			'ratings',
			async () => ratingCommit,
			1,
			() => true
		);
		reads.register(
			'A',
			'bookmarks',
			async () => {
				throw new Error('offline');
			},
			1,
			() => true
		);
		const loading = Promise.all([reads.load('ratings'), reads.load('bookmarks')]);
		await vi.advanceTimersByTimeAsync(0);
		expect(get(reads).collections.ratings.hasSnapshot).toBe(true);
		expect(get(reads).collections.bookmarks.hasSnapshot).toBe(false);
		await vi.advanceTimersByTimeAsync(8000);
		await loading;
		expect(ratingCommit).toHaveBeenCalledOnce();
		expect(get(reads).collections.bookmarks.status).toBe('error');
	});

	it('shares an active request and preserves its last snapshot after a failed refresh', async () => {
		let displayed = ['cached'];
		let resolve!: (commit: () => void) => void;
		const request = new Promise<() => void>((done) => {
			resolve = done;
		});
		reads.register(
			'A',
			'bookmarkDetails',
			() => request,
			1,
			() => true
		);
		const first = reads.load('bookmarkDetails');
		expect(reads.load('bookmarkDetails')).toBe(first);
		resolve(() => {
			displayed = ['saved'];
		});
		await first;
		reads.register(
			'A',
			'bookmarkDetails',
			async () => {
				throw Object.assign(new Error('denied'), { status: 403 });
			},
			2,
			() => true
		);
		await reads.load('bookmarkDetails');
		expect(displayed).toEqual(['saved']);
		expect(get(reads).collections.bookmarkDetails).toMatchObject({
			status: 'error',
			hasSnapshot: true
		});
	});

	it('treats a successful empty response as a usable snapshot', async () => {
		let displayed = ['old'];
		reads.register(
			'A',
			'ratings',
			async () => () => {
				displayed = [];
			},
			1,
			() => true
		);
		await reads.load('ratings');
		expect(displayed).toEqual([]);
		expect(get(reads).collections.ratings).toMatchObject({ status: 'ready', hasSnapshot: true });
	});

	it('cancels retries and discards a late response when the account changes', async () => {
		let resolve!: (commit: () => void) => void;
		const request = new Promise<() => void>((done) => {
			resolve = done;
		});
		const oldCommit = vi.fn();
		reads.register(
			'A',
			'ratings',
			() => request,
			1,
			() => true
		);
		const first = reads.load('ratings');
		reads.activate('B');
		resolve(oldCommit);
		await first;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(oldCommit).not.toHaveBeenCalled();
		expect(get(reads).userId).toBe('B');
		expect(get(reads).collections.ratings.hasSnapshot).toBe(false);
	});

	it('cancels backoff timers on account changes', async () => {
		const read = vi.fn(async () => {
			throw new Error('offline');
		});
		reads.register('A', 'ratings', read, 1, () => true);
		const first = reads.load('ratings');
		await vi.advanceTimersByTimeAsync(0);
		reads.activate('B');
		await first;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(read).toHaveBeenCalledOnce();
	});

	it('times out a hung read and ignores it after a newer retry succeeds', async () => {
		let resolve!: (commit: () => void) => void;
		const old = new Promise<() => void>((done) => {
			resolve = done;
		});
		const oldCommit = vi.fn();
		const currentCommit = vi.fn();
		const read = vi.fn().mockReturnValueOnce(old).mockResolvedValue(currentCommit);
		reads.register('A', 'ratings', read, 1, () => true);
		const loading = reads.load('ratings');
		await vi.advanceTimersByTimeAsync(1100);
		await loading;
		resolve(oldCommit);
		await vi.advanceTimersByTimeAsync(0);
		expect(oldCommit).not.toHaveBeenCalled();
		expect(currentCommit).toHaveBeenCalledOnce();
		expect(get(reads).collections.ratings.status).toBe('ready');
	});
});
