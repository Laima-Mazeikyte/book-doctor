import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	createRateFeedController,
	RateFeedReadError,
	type LatestFeedStateResponse
} from './rateFeedController';

const identity = { userId: 'account-a', accessToken: 'token-a' };
const books = ['a', 'b', 'c'].map((id) => ({
	id,
	book_id: `ulid-${id}`,
	title: id,
	author: 'Author'
}));
const payload = (overrides: Partial<LatestFeedStateResponse> = {}): LatestFeedStateResponse => ({
	mode: 'has_eligible_feed',
	books,
	request_id: '42',
	latest_request_id: '42',
	latest_request_status: 'completed',
	latest_request_error_message: null,
	ratings_count: 1,
	interaction_count: 1,
	eligible_for_feed: true,
	status: 'completed',
	error_message: null,
	...overrides
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function fixture() {
	let time = 1000;
	const readLatest = vi.fn().mockResolvedValue(payload());
	const controller = createRateFeedController({ readLatest, now: () => time });
	controller.setOwner(identity.userId);
	return {
		controller,
		readLatest,
		advance: (ms: number) => {
			time += ms;
		}
	};
}

describe('account-owned rate feed controller', () => {
	it('deduplicates preparation and reuses a recent result until it expires or is forced', async () => {
		const { controller, readLatest, advance } = fixture();
		const read = deferred<LatestFeedStateResponse>();
		readLatest.mockReturnValueOnce(read.promise);
		const first = controller.prepare(identity);
		expect(controller.prepare(identity)).toBe(first);
		read.resolve(payload());
		await first;
		await controller.prepare(identity);
		expect(readLatest).toHaveBeenCalledTimes(1);
		advance(5 * 60_000);
		await controller.prepare(identity);
		await controller.prepare(identity, { force: true });
		expect(readLatest).toHaveBeenCalledTimes(3);
	});

	it('retains an account read across navigation and prevents the departed entry from generating or committing', async () => {
		const { controller, readLatest } = fixture();
		const read = deferred<LatestFeedStateResponse>();
		readLatest.mockReturnValue(read.promise);
		const firstEntry = controller.enter();
		const generate = vi.fn();
		const oldChoice = controller.resolveInitial(firstEntry, identity, generate);
		controller.leave(firstEntry);
		const nextEntry = controller.enter();
		const nextChoice = controller.resolveInitial(nextEntry, identity, generate);
		read.resolve(payload());

		expect(await oldChoice).toBeNull();
		expect(await nextChoice).toMatchObject({ kind: 'curated', books });
		expect(readLatest).toHaveBeenCalledTimes(1);
		expect(generate).not.toHaveBeenCalled();
		expect(controller.setActiveBooks(firstEntry, books, 'replace')).toEqual([]);
		expect(get(controller).activeBooks).toEqual([]);
		expect(get(controller).preparedSnapshot?.payload.books).toEqual(books);
	});

	it('stages reordered/changed/excluded books without changing the active references or loading state', async () => {
		const { controller, readLatest } = fixture();
		const entry = controller.enter();
		await controller.prepare(identity);
		controller.setActiveBooks(entry, books, 'replace', { kind: 'curated', requestId: '42' });
		controller.setInitialLoading(entry, false);
		const active = get(controller).activeBooks;
		const replacement = [{ ...books[2], title: 'Updated elsewhere' }, books[0]];
		readLatest.mockResolvedValueOnce(payload({ books: replacement, request_id: '43' }));
		await controller.prepare(identity, { force: true });
		controller.setInitialLoading(entry, true);

		expect(get(controller).activeBooks).toBe(active);
		expect(get(controller).activeBooks[2]).toBe(books[2]);
		expect(get(controller).activeSource?.requestId).toBe('42');
		expect(get(controller).preparedSnapshot?.payload.books).toBe(replacement);
		expect(get(controller).loadingInitial).toBe(false);
	});

	it('keeps usable content on failed or empty refresh and permits a later retry', async () => {
		const { controller, readLatest } = fixture();
		const entry = controller.enter();
		await controller.prepare(identity);
		controller.setActiveBooks(entry, books, 'replace');
		controller.setInitialLoading(entry, false);
		const active = get(controller).activeBooks;
		const snapshot = get(controller).preparedSnapshot;
		readLatest.mockRejectedValueOnce(new Error('Network unavailable'));
		await expect(controller.prepare(identity, { force: true })).rejects.toThrow(
			'Network unavailable'
		);
		expect(get(controller)).toMatchObject({
			refreshing: false,
			refreshError: 'Network unavailable',
			loadingInitial: false
		});
		expect(get(controller).preparedSnapshot).toBe(snapshot);
		expect(get(controller).activeBooks).toBe(active);
		readLatest.mockResolvedValueOnce(payload({ books: [], mode: 'feed_exhausted' }));
		await controller.prepare(identity, { force: true });
		expect(get(controller).activeBooks).toBe(active);
		expect(get(controller).refreshError).toBeNull();
		expect(get(controller).preparedSnapshot?.payload.books).toEqual([]);
	});

	it('aborts an old account and ignores late results even when switching back to the same account', async () => {
		const { controller, readLatest } = fixture();
		const oldRead = deferred<LatestFeedStateResponse>();
		const newRead = deferred<LatestFeedStateResponse>();
		readLatest.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
		const oldPromise = controller.prepare(identity);
		await Promise.resolve();
		const signal = readLatest.mock.calls[0][1] as AbortSignal;
		controller.setOwner('account-b');
		controller.setOwner(identity.userId);
		const current = controller.prepare({ ...identity, accessToken: 'new-token' });
		oldRead.resolve(payload());
		expect(await oldPromise).toBeNull();
		expect(signal.aborted).toBe(true);
		expect(get(controller)).toMatchObject({
			refreshing: true,
			preparedSnapshot: null,
			activeBooks: []
		});
		newRead.resolve(payload({ request_id: '99' }));
		await current;
		expect(get(controller).preparedSnapshot?.payload.request_id).toBe('99');
	});

	it('ignores an old account error without clearing the new account request', async () => {
		const { controller, readLatest } = fixture();
		const oldRead = deferred<LatestFeedStateResponse>();
		readLatest.mockReturnValueOnce(oldRead.promise);
		const oldPromise = controller.prepare(identity);
		await Promise.resolve();
		controller.setOwner('account-b');
		oldRead.reject(new Error('Old request failed'));
		expect(await oldPromise).toBeNull();
		expect(get(controller)).toMatchObject({
			ownerId: 'account-b',
			refreshError: null,
			activeBooks: [],
			preparedSnapshot: null
		});
	});

	it('does not invalidate an active list when only the session token refreshes', async () => {
		const { controller, readLatest } = fixture();
		const entry = controller.enter();
		controller.setActiveBooks(entry, books, 'replace');
		await controller.prepare(identity);
		controller.setOwner(identity.userId);
		await controller.prepare({ ...identity, accessToken: 'refreshed-token' });
		expect(controller.isCurrentEntry(entry)).toBe(true);
		expect(get(controller).activeBooks).toEqual(books);
		expect(readLatest).toHaveBeenCalledTimes(1);
	});

	it.each([401, 403])(
		'requires fresh validation after HTTP %s while leaving an already mounted list stable',
		async (status) => {
			const { controller, readLatest } = fixture();
			const entry = controller.enter();
			await controller.prepare(identity);
			controller.setActiveBooks(entry, books, 'replace');
			controller.setInitialLoading(entry, false);
			const active = get(controller).activeBooks;
			readLatest.mockRejectedValueOnce(new RateFeedReadError(status));
			await expect(controller.prepare(identity, { force: true })).rejects.toThrow(`HTTP ${status}`);
			expect(get(controller).activeBooks).toBe(active);
			expect(get(controller).preparedSnapshot).toBeNull();
			await controller.prepare(identity);
			expect(readLatest).toHaveBeenCalledTimes(3);
		}
	);

	it('appends each unique catalog book once while preserving existing references and order', () => {
		const { controller } = fixture();
		const entry = controller.enter();
		controller.setActiveBooks(entry, [books[0]], 'replace');
		const added = controller.setActiveBooks(
			entry,
			[books[0], books[1], books[1], books[2]],
			'append'
		);
		expect(added).toEqual([books[1], books[2]]);
		expect(get(controller).activeBooks).toEqual(books);
		expect(get(controller).activeBooks[0]).toBe(books[0]);
	});

	it.each(['feed_exhausted', 'feed_generation_pending', 'feed_error', 'no_feed_yet'] as const)(
		'deduplicates the active entry generation decision for %s and preserves fallback behavior',
		async (mode) => {
			const { controller, readLatest } = fixture();
			readLatest.mockResolvedValue(payload({ mode, books: [] }));
			const entry = controller.enter();
			const generate = vi.fn().mockResolvedValue(null);
			const choice = controller.resolveInitial(entry, identity, generate);
			expect(controller.resolveInitial(entry, identity, generate)).toBe(choice);
			expect(await choice).toEqual({ kind: 'popular', preservePersonalizedFeedMode: true });
			expect(generate).toHaveBeenCalledTimes(1);
			expect(get(controller).preparedSnapshot).toBeNull();
		}
	);

	it('uses the public fallback without reads for a signed-out visitor or generation below threshold', async () => {
		const { controller, readLatest } = fixture();
		const generate = vi.fn();
		const entry = controller.enter();
		expect(await controller.resolveInitial(entry, null, generate)).toEqual({
			kind: 'popular',
			preservePersonalizedFeedMode: false
		});
		expect(readLatest).not.toHaveBeenCalled();
		readLatest.mockResolvedValue(
			payload({
				mode: 'below_threshold',
				books: [],
				interaction_count: 0,
				ratings_count: 0,
				eligible_for_feed: false
			})
		);
		expect(await controller.resolveInitial(controller.enter(), identity, generate)).toEqual({
			kind: 'popular',
			preservePersonalizedFeedMode: false
		});
		expect(generate).not.toHaveBeenCalled();
	});

	it('hands the generated batch identity to the page and ignores a generation finishing after departure', async () => {
		const { controller, readLatest } = fixture();
		readLatest.mockResolvedValue(payload({ mode: 'feed_exhausted', books: [] }));
		const generate = vi.fn().mockResolvedValue({ books, requestId: 'generated-request' });
		expect(await controller.resolveInitial(controller.enter(), identity, generate)).toEqual({
			kind: 'curated',
			books,
			requestId: 'generated-request'
		});
		const pending = deferred<{ books: typeof books; requestId: string }>();
		generate.mockReturnValueOnce(pending.promise);
		const entry = controller.enter();
		const choice = controller.resolveInitial(entry, identity, generate);
		await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
		controller.leave(entry);
		pending.resolve({ books, requestId: 'late-request' });
		expect(await choice).toBeNull();
	});

	it('invalidates reusable snapshots on local intent without changing the list or caching an older in-flight result', async () => {
		const { controller, readLatest } = fixture();
		const entry = controller.enter();
		controller.setActiveBooks(entry, books, 'replace');
		const active = get(controller).activeBooks;
		const read = deferred<LatestFeedStateResponse>();
		readLatest.mockReturnValueOnce(read.promise);
		const pending = controller.prepare(identity);
		controller.invalidatePrepared();
		read.resolve(payload());
		await pending;
		expect(get(controller).preparedSnapshot).toBeNull();
		expect(get(controller).activeBooks).toBe(active);
		await controller.prepare(identity);
		expect(readLatest).toHaveBeenCalledTimes(2);
	});

	it('keeps only public signed-out books during lazy anonymous sign-in, and clears personalized books on account changes', () => {
		const { controller } = fixture();
		controller.setOwner(null);
		controller.setActiveBooks(controller.enter(), books, 'replace', {
			kind: 'popular',
			requestId: null
		});
		controller.setOwner('anonymous', { retainPublicBooks: true });
		expect(get(controller).activeBooks).toEqual(books);
		controller.setOwner('another-account', { retainPublicBooks: true });
		expect(get(controller).activeBooks).toEqual([]);
		controller.setActiveBooks(controller.enter(), books, 'replace', {
			kind: 'curated',
			requestId: '42'
		});
		controller.setOwner(null);
		expect(get(controller).activeBooks).toEqual([]);
	});

	it('isolates layout instances and ignores requests after destruction', async () => {
		const { controller } = fixture();
		const { controller: other } = fixture();
		controller.setActiveBooks(controller.enter(), books, 'replace');
		expect(get(other).activeBooks).toEqual([]);
		controller.destroy();
		expect(await controller.prepare(identity)).toBeNull();
		expect(get(controller).activeBooks).toEqual([]);
	});
});
