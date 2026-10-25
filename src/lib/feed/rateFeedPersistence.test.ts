import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	createRateFeedController,
	RateFeedReadError,
	type LatestFeedStateResponse,
	type RateFeedController
} from './rateFeedController';
import { createRateFeedCache, RATE_FEED_CACHE_PREFIX, type CachedRateFeed } from './rateFeedCache';

const identity = { userId: 'account-a', accessToken: 'token' };
const books = ['a', 'b', 'c'].map((id) => ({
	id,
	book_id: `ulid-${id}`,
	title: id,
	author: 'Author'
}));
const payload = (incoming = books): LatestFeedStateResponse => ({
	mode: incoming.length ? 'has_eligible_feed' : 'feed_exhausted',
	books: incoming,
	request_id: '42',
	latest_request_id: '42',
	latest_request_status: 'completed',
	latest_request_error_message: null,
	status: 'completed',
	error_message: null,
	ratings_count: 1,
	interaction_count: 1,
	eligible_for_feed: true
});
const stored = (): CachedRateFeed => ({
	version: 1,
	ownerId: identity.userId,
	fetchedAt: 1000,
	source: { kind: 'curated', requestId: 'old-request' },
	books
});
let controllers: RateFeedController[];
function fixture() {
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
	const readLatest = vi.fn().mockResolvedValue(payload());
	const controller = createRateFeedController({ readLatest, cache });
	controllers.push(controller);
	controller.setOwner(identity.userId);
	return { controller, cache, data, readLatest };
}
beforeEach(() => {
	controllers = [];
	vi.useFakeTimers();
	vi.setSystemTime(10_000);
});
afterEach(() => {
	controllers.forEach((controller) => controller.destroy());
	vi.useRealTimers();
});

describe('persistent feed admission and reconciliation', () => {
	it('restores filtered candidates without a network read or extending their lifetime', async () => {
		const { controller, cache, readLatest } = fixture();
		cache.write(stored());
		const entry = controller.enter();
		const cached = controller.restoreInitial(entry, (rows) => rows.slice(1));
		expect(cached?.books).toEqual(books.slice(1));
		expect(readLatest).not.toHaveBeenCalled();
		controller.setActiveBooks(entry, cached!.books, 'replace', cached!.source);
		controller.setInitialLoading(entry, false);
		await vi.advanceTimersByTimeAsync(300);
		expect(cache.read(identity.userId)?.fetchedAt).toBe(1000);
		expect(get(controller).loadingInitial).toBe(false);
	});

	it('treats a completely filtered snapshot as a miss and preserves the ordinary fresh choice', async () => {
		const { controller, cache, readLatest } = fixture();
		cache.write(stored());
		const entry = controller.enter();
		expect(controller.restoreInitial(entry, () => [])).toBeNull();
		expect(await controller.resolveInitial(entry, identity, vi.fn())).toMatchObject({
			kind: 'curated',
			books
		});
		expect(readLatest).toHaveBeenCalledOnce();
	});

	it('deduplicates background reads, stages changed candidates, and preserves active objects', async () => {
		const { controller, cache, readLatest } = fixture();
		cache.write(stored());
		const entry = controller.enter();
		controller.setActiveBooks(
			entry,
			controller.restoreInitial(entry, (rows) => rows)!.books,
			'replace'
		);
		controller.setInitialLoading(entry, false);
		const active = get(controller).activeBooks;
		let resolve!: (value: LatestFeedStateResponse) => void;
		readLatest.mockReturnValue(
			new Promise<LatestFeedStateResponse>((done) => {
				resolve = done;
			})
		);
		const first = controller.prepare(identity, { force: true });
		expect(controller.prepare(identity)).toBe(first);
		resolve(payload([{ ...books[2], title: 'New metadata' }]));
		await first;
		await vi.advanceTimersByTimeAsync(200);
		expect(get(controller).activeBooks).toBe(active);
		expect(cache.read(identity.userId)?.books[0].title).toBe('New metadata');
		expect(controller.restoreInitial(controller.enter(), (rows) => rows)).toBeNull();
	});

	it('retires an authoritative empty snapshot for future entries while preserving the mounted list', async () => {
		const { controller, cache, readLatest } = fixture();
		cache.write(stored());
		const entry = controller.enter();
		controller.setActiveBooks(entry, books, 'replace');
		readLatest.mockResolvedValue(payload([]));
		await controller.prepare(identity);
		expect(cache.read(identity.userId)).toBeNull();
		expect(get(controller).activeBooks).toEqual(books);
	});

	it.each([500, 401, 403])(
		'preserves displayed books and handles HTTP %s cache policy',
		async (status) => {
			const { controller, cache, readLatest } = fixture();
			cache.write(stored());
			const entry = controller.enter();
			controller.setActiveBooks(entry, books, 'replace');
			readLatest.mockRejectedValue(new RateFeedReadError(status));
			await expect(controller.prepare(identity)).rejects.toThrow();
			expect(get(controller).activeBooks).toEqual(books);
			expect(cache.read(identity.userId) === null).toBe(status !== 500);
		}
	);

	it('keeps only the most recent 100 displayed books and persists generated batches on destruction', () => {
		const { controller, cache } = fixture();
		const incoming = Array.from({ length: 150 }, (_, i) => ({
			id: String(i),
			book_id: `ulid-${i}`,
			title: String(i),
			author: 'Author'
		}));
		const entry = controller.enter();
		controller.setActiveBooks(entry, incoming, 'replace');
		controller.rememberActive(entry, { kind: 'curated', requestId: 'generated' });
		controller.destroy();
		expect(cache.read(identity.userId)?.books).toEqual(incoming.slice(-100));
	});

	it('does not replay a queued write or a late request after logout clears its snapshot', async () => {
		const { controller, cache, readLatest } = fixture();
		await controller.prepare(identity);
		let resolve!: (value: LatestFeedStateResponse) => void;
		readLatest.mockReturnValue(
			new Promise<LatestFeedStateResponse>((done) => {
				resolve = done;
			})
		);
		const old = controller.prepare(identity, { force: true });
		await Promise.resolve();
		controller.clearPersisted(identity.userId);
		controller.setOwner(null);
		resolve(payload());
		await old;
		await vi.advanceTimersByTimeAsync(500);
		expect(cache.read(identity.userId)).toBeNull();
		expect(get(controller).activeBooks).toEqual([]);
	});

	it('local invalidation keeps filterable disk candidates without persisting an older in-flight response', async () => {
		const { controller, cache, readLatest } = fixture();
		cache.write(stored());
		let resolve!: (value: LatestFeedStateResponse) => void;
		readLatest.mockReturnValue(
			new Promise<LatestFeedStateResponse>((done) => {
				resolve = done;
			})
		);
		const old = controller.prepare(identity);
		controller.invalidatePrepared();
		resolve(payload([]));
		await old;
		expect(cache.read(identity.userId)).toEqual(stored());
	});

	it('preserves the original read timestamp when remembering a list admitted from recent memory', async () => {
		const { controller, cache } = fixture();
		await controller.prepare(identity);
		vi.setSystemTime(20_000);
		const entry = controller.enter();
		controller.setActiveBooks(entry, books, 'replace');
		controller.rememberActive(entry, { kind: 'curated', requestId: '42' });
		controller.flushSnapshot();
		expect(cache.read(identity.userId)?.fetchedAt).toBe(10_000);
	});

	it('does not access browser storage until admission and supports SSR without persistence', () => {
		const read = vi.fn();
		const cache = { read, write: vi.fn(), clear: vi.fn() };
		const controller = createRateFeedController({ readLatest: vi.fn(), cache });
		controllers.push(controller);
		controller.setOwner(identity.userId);
		controller.enter();
		expect(read).not.toHaveBeenCalled();
		const disabled = createRateFeedController({ readLatest: vi.fn() });
		controllers.push(disabled);
		disabled.setOwner(identity.userId);
		expect(disabled.restoreInitial(disabled.enter(), (rows) => rows)).toBeNull();
	});

	it('isolates disk reads by account and does not restore another identity envelope', () => {
		const { controller, cache, data } = fixture();
		cache.write(stored());
		controller.setOwner('account-b');
		expect(controller.restoreInitial(controller.enter(), (rows) => rows)).toBeNull();
		data.set(RATE_FEED_CACHE_PREFIX + 'account-b', JSON.stringify(stored()));
		expect(controller.restoreInitial(controller.enter(), (rows) => rows)).toBeNull();
	});
});
