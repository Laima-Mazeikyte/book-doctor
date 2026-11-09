import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	createSelectionCandidatesController,
	type SelectionCandidates
} from './selectionCandidates';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
const book = { id: 'uuid', book_id: 'ulid', title: 'Candidate', author: 'Author' };
const payload: SelectionCandidates = { books: [book], lastRecommendedAt: { ulid: 123 } };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('joins concurrent reads and caches successful empty results', async () => {
	const read = vi.fn().mockResolvedValue({ books: [], lastRecommendedAt: {} });
	const store = createSelectionCandidatesController(read);
	const first = store.load('A');
	expect(store.load('A')).toBe(first);
	await first;
	await store.load('A');
	expect(read).toHaveBeenCalledOnce();
	expect(get(store)).toMatchObject({ owner: 'A', loaded: true, loading: false, books: [] });
});

it('keeps cached books available during refresh and waits for explicit retry after failure', async () => {
	const read = vi.fn().mockRejectedValue(new Error('offline'));
	const store = createSelectionCandidatesController(read);
	store.activate('A');
	store.seed('A', payload);
	store.invalidate();
	const refresh = store.load('A');
	expect(get(store)).toMatchObject({ loaded: true, loading: true, books: [book] });
	await refresh;
	expect(get(store).error).toBe('Could not load previous recommendations.');
	await store.load('A');
	expect(read).toHaveBeenCalledOnce();
	read.mockResolvedValue(payload);
	await store.load('A', true);
	expect(get(store)).toMatchObject({ loaded: true, loading: false, error: '', books: [book] });
});

it('discards old-account responses and clears all cached records on account changes', async () => {
	let release!: (payload: SelectionCandidates) => void;
	const read = vi
		.fn()
		.mockImplementationOnce(
			() =>
				new Promise((done) => {
					release = done;
				})
		)
		.mockResolvedValue({ books: [], lastRecommendedAt: {} });
	const store = createSelectionCandidatesController(read);
	const first = store.load('A');
	await store.load('B');
	release(payload);
	await first;
	expect(get(store)).toMatchObject({ owner: 'B', loaded: true, books: [] });
	store.activate(null);
	expect(get(store)).toMatchObject({ owner: null, loaded: false, books: [] });
});

it('invalidates in-flight reads without allowing a stale transport to publish', async () => {
	let release!: (payload: SelectionCandidates) => void;
	const read = vi
		.fn()
		.mockImplementationOnce(
			() =>
				new Promise((done) => {
					release = done;
				})
		)
		.mockResolvedValue({ books: [], lastRecommendedAt: {} });
	const store = createSelectionCandidatesController(read);
	const first = store.load('A');
	store.invalidate();
	await store.load('A');
	release(payload);
	await first;
	expect(get(store)).toMatchObject({ loaded: true, stale: false, books: [] });
});

it('accepts a full-page snapshot instead of repeating a lightweight request', async () => {
	const read = vi.fn();
	const store = createSelectionCandidatesController(read);
	store.activate('A');
	store.seed('A', payload);
	await store.load('A');
	expect(read).not.toHaveBeenCalled();
	expect(get(store).books).toEqual([book]);
});

it('revalidates old snapshots on a later visit without discarding the available books', async () => {
	const read = vi.fn().mockResolvedValue(payload);
	const store = createSelectionCandidatesController(read);
	await store.load('A');
	await vi.advanceTimersByTimeAsync(60_000);
	const loading = store.load('A');
	expect(get(store)).toMatchObject({ loaded: true, loading: true, books: [book] });
	await loading;
	expect(read).toHaveBeenCalledTimes(2);
});

it('bounds a hung source read and leaves a retryable error instead of an empty snapshot', async () => {
	const store = createSelectionCandidatesController(() => new Promise(() => {}));
	const loading = store.load('A');
	await vi.advanceTimersByTimeAsync(15_000);
	await loading;
	expect(get(store)).toMatchObject({
		loaded: false,
		loading: false,
		error: 'Could not load previous recommendations.'
	});
});
