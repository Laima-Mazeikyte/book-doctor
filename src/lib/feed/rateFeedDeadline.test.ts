import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { FEED_READ_TIMEOUT_MS } from './constants';
import { readLatestRateFeed } from './rateFeedContext';
import {
	createRateFeedController,
	RateFeedReadTimeoutError,
	type LatestFeedStateResponse,
	type RateFeedController
} from './rateFeedController';
import { createRateFeedCache } from './rateFeedCache';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const identity = { userId: 'deadline-owner', accessToken: 'fixture-token' };
const books = [{ id: 'book', book_id: 'book-ulid', title: 'Book', author: 'Author' }];
const payload: LatestFeedStateResponse = {
	mode: 'has_eligible_feed',
	books,
	request_id: 'live',
	latest_request_id: 'live',
	latest_request_status: 'completed',
	latest_request_error_message: null,
	ratings_count: 1,
	interaction_count: 1,
	eligible_for_feed: true,
	status: 'completed',
	error_message: null
};
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
let controllers: RateFeedController[];
function fixture(
	readLatest = vi.fn().mockResolvedValue(payload),
	readTimeoutMs = FEED_READ_TIMEOUT_MS
) {
	const data = new Map<string, string>();
	const cache = createRateFeedCache({
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
	const controller = createRateFeedController({ readLatest, readTimeoutMs, cache });
	controllers.push(controller);
	controller.setOwner(identity.userId);
	return { controller, cache, readLatest };
}
beforeEach(() => {
	controllers = [];
	vi.useFakeTimers();
});
afterEach(() => {
	controllers.forEach((controller) => controller.destroy());
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('shared feed read deadline', () => {
	it('releases a never-settling shared read at ten seconds, aborts it, and allows retry', async () => {
		const late = deferred<LatestFeedStateResponse>();
		const { controller, readLatest } = fixture();
		readLatest.mockReturnValueOnce(late.promise);
		const first = controller.prepare(identity);
		const rejected = expect(first).rejects.toBeInstanceOf(RateFeedReadTimeoutError);
		expect(controller.prepare(identity)).toBe(first);
		await vi.advanceTimersByTimeAsync(FEED_READ_TIMEOUT_MS - 1);
		expect(get(controller).refreshing).toBe(true);
		await vi.advanceTimersByTimeAsync(1);
		await rejected;
		expect(readLatest.mock.calls[0][1].aborted).toBe(true);
		expect(get(controller)).toMatchObject({ refreshing: false, preparedSnapshot: null });
		await controller.prepare(identity);
		late.resolve({ ...payload, request_id: 'obsolete' });
		await vi.advanceTimersByTimeAsync(0);
		expect(get(controller).preparedSnapshot?.payload.request_id).toBe('live');
		expect(readLatest).toHaveBeenCalledTimes(2);
	});

	it('includes waiting for the response body in the original deadline', async () => {
		const headers = deferred<Response>();
		const body = deferred<LatestFeedStateResponse>();
		const fetchMock = vi
			.fn()
			.mockReturnValueOnce(headers.promise)
			.mockResolvedValue({ ok: true, json: async () => payload });
		vi.stubGlobal('fetch', fetchMock);
		const { controller } = fixture(vi.fn(readLatestRateFeed));
		const first = controller.prepare(identity);
		const rejected = expect(first).rejects.toBeInstanceOf(RateFeedReadTimeoutError);
		await vi.advanceTimersByTimeAsync(9000);
		headers.resolve({ ok: true, json: () => body.promise } as Response);
		await vi.advanceTimersByTimeAsync(999);
		expect(get(controller).refreshing).toBe(true);
		await vi.advanceTimersByTimeAsync(1);
		await rejected;
		expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
		await controller.prepare(identity);
		body.resolve({ ...payload, books: [], mode: 'feed_exhausted' });
		await vi.advanceTimersByTimeAsync(0);
		expect(get(controller).preparedSnapshot?.payload.books).toEqual(books);
	});

	it('preserves cached and mounted books when background refresh times out', async () => {
		const { controller, cache, readLatest } = fixture();
		cache.write({
			version: 1,
			ownerId: identity.userId,
			fetchedAt: Date.now(),
			source: { kind: 'curated', requestId: 'cached' },
			books
		});
		const entry = controller.enter();
		const cached = controller.restoreInitial(entry, (rows) => rows)!;
		controller.setActiveBooks(entry, cached.books, 'replace', cached.source);
		controller.setInitialLoading(entry, false);
		const active = get(controller).activeBooks;
		readLatest.mockImplementationOnce(() => new Promise(() => {}));
		const rejected = expect(controller.prepare(identity)).rejects.toBeInstanceOf(
			RateFeedReadTimeoutError
		);
		await vi.advanceTimersByTimeAsync(FEED_READ_TIMEOUT_MS);
		await rejected;
		expect(get(controller).activeBooks).toBe(active);
		expect(get(controller).loadingInitial).toBe(false);
		expect(cache.read(identity.userId)?.books).toEqual(books);
	});

	it('unblocks the ordinary cache-miss fallback without generating on timeout', async () => {
		const { controller, readLatest } = fixture();
		readLatest.mockImplementationOnce(() => new Promise(() => {}));
		const generate = vi.fn();
		const choice = controller.resolveInitial(controller.enter(), identity, generate);
		await vi.advanceTimersByTimeAsync(FEED_READ_TIMEOUT_MS);
		expect(await choice).toEqual({ kind: 'popular', preservePersonalizedFeedMode: false });
		expect(generate).not.toHaveBeenCalled();
	});

	it('settles ownership cancellation even if transport ignores abort and clears its timer', async () => {
		const { controller, readLatest } = fixture();
		const old = deferred<LatestFeedStateResponse>();
		readLatest.mockReturnValueOnce(old.promise);
		const first = controller.prepare(identity);
		await Promise.resolve();
		controller.setOwner('new-owner');
		expect(await first).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
		await controller.prepare({ ...identity, userId: 'new-owner' });
		old.reject(new Error('Late failure'));
		await vi.advanceTimersByTimeAsync(0);
		expect(get(controller).preparedSnapshot?.ownerId).toBe('new-owner');
		expect(get(controller).refreshError).toBeNull();
	});

	it('supports a configured deadline and clears it on destruction', async () => {
		const { controller } = fixture(
			vi.fn(() => new Promise(() => {})),
			25
		);
		const rejected = expect(controller.prepare(identity)).rejects.toBeInstanceOf(
			RateFeedReadTimeoutError
		);
		await vi.advanceTimersByTimeAsync(25);
		await rejected;
		const next = controller.prepare(identity);
		controller.destroy();
		expect(await next).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});
});
