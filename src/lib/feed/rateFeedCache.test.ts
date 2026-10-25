import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createRateFeedCache,
	RATE_FEED_CACHE_MAX_AGE_MS,
	RATE_FEED_CACHE_PREFIX,
	type CachedRateFeed
} from './rateFeedCache';

const owner = 'account-a';
const snapshot = (overrides: Partial<CachedRateFeed> = {}): CachedRateFeed => ({
	version: 1,
	ownerId: owner,
	fetchedAt: 1000,
	source: { kind: 'curated', requestId: '42' },
	books: [
		{
			id: 'uuid',
			book_id: 'ulid',
			title: 'Title',
			author: 'Author',
			coverUrl: 'https://covers.example/ulid.avif',
			summary: 'Full description',
			year: '1972',
			genres: ['Fiction'],
			type: 'Novel',
			qualityBand: 'top_1_percent'
		}
	],
	...overrides
});
function fixture() {
	const data = new Map<string, string>();
	const storage = {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
		removeItem: (key: string) => {
			data.delete(key);
		}
	};
	const cache = createRateFeedCache({ storage: () => storage, now: () => 1000 });
	return { data, storage, cache };
}
afterEach(() => vi.unstubAllGlobals());

describe('bounded account feed display snapshots', () => {
	it('round-trips all card/detail fields without retaining unknown metadata or credentials', () => {
		const { cache, data } = fixture();
		const input = {
			...snapshot(),
			accessToken: 'do-not-store',
			latest_request_status: 'processing'
		};
		cache.write(input);
		expect(cache.read(owner)).toEqual(snapshot());
		expect(data.get(RATE_FEED_CACHE_PREFIX + owner)).not.toContain('do-not-store');
		expect(cache.read('account-b')).toBeNull();
	});
	it('round-trips popular pagination hints independently of generation state', () => {
		const { cache } = fixture();
		const input = snapshot({
			source: { kind: 'popular', requestId: null, seed: 'seed', nextOffset: 50, hasMore: true }
		});
		cache.write(input);
		expect(cache.read(owner)).toEqual(input);
	});
	it('expires at 24 hours, rejects future timestamps, and never refreshes age on read', () => {
		const { cache, storage, data } = fixture();
		cache.write(snapshot());
		const before = data.get(RATE_FEED_CACHE_PREFIX + owner);
		expect(
			createRateFeedCache({
				storage: () => storage,
				now: () => 1000 + RATE_FEED_CACHE_MAX_AGE_MS - 1
			}).read(owner)
		).not.toBeNull();
		expect(
			createRateFeedCache({
				storage: () => storage,
				now: () => 1000 + RATE_FEED_CACHE_MAX_AGE_MS
			}).read(owner)
		).toBeNull();
		expect(createRateFeedCache({ storage: () => storage, now: () => 999 }).read(owner)).toBeNull();
		expect(data.get(RATE_FEED_CACHE_PREFIX + owner)).toBe(before);
	});
	it.each([
		{ version: 2 },
		{ ownerId: 'account-b' },
		{ fetchedAt: -1 },
		{ books: [] },
		{ source: { kind: 'unknown', requestId: null } },
		{ source: { kind: 'popular', requestId: null, seed: null, nextOffset: -1, hasMore: true } },
		{ books: [snapshot().books[0], snapshot().books[0]] },
		{ books: [{ ...snapshot().books[0], title: 42 }] },
		{ books: [{ ...snapshot().books[0], qualityBand: ['top_1_percent'] }] },
		{ books: [{ ...snapshot().books[0], coverUrl: 'javascript:alert(1)' }] },
		{ books: [{ ...snapshot().books[0], genres: [null] }] }
	])('rejects an entire malformed snapshot rather than admitting a subset: %j', (patch) => {
		const { cache, data } = fixture();
		data.set(RATE_FEED_CACHE_PREFIX + owner, JSON.stringify({ ...snapshot(), ...patch }));
		expect(cache.read(owner)).toBeNull();
	});
	it('bounds count and size and tolerates invalid JSON and blocked storage', () => {
		const { cache, data } = fixture();
		for (const raw of [
			'not json',
			' '.repeat(1_500_001),
			JSON.stringify(
				snapshot({
					books: Array.from({ length: 101 }, (_, i) => ({
						id: String(i),
						book_id: String(i),
						title: 'T',
						author: 'A'
					}))
				})
			)
		]) {
			data.set(RATE_FEED_CACHE_PREFIX + owner, raw);
			expect(cache.read(owner)).toBeNull();
		}
		const blocked = createRateFeedCache({
			storage: () => {
				throw new Error('Blocked');
			}
		});
		expect(blocked.read(owner)).toBeNull();
		expect(() => blocked.write(snapshot())).not.toThrow();
		expect(() => blocked.clear(owner)).not.toThrow();
		vi.stubGlobal('window', undefined);
		expect(createRateFeedCache().read(owner)).toBeNull();
	});
	it('clears only this account feed, leaving interaction snapshots and pending-save journals intact', () => {
		const { cache, data } = fixture();
		cache.write(snapshot());
		cache.write(snapshot({ ownerId: 'account-b' }));
		data.set('book-doctor:library-pending:v1:account-a', 'pending');
		data.set('book-doctor:library-cache:v2:account-a', 'interactions');
		cache.clear(owner);
		expect(cache.read(owner)).toBeNull();
		expect(cache.read('account-b')).not.toBeNull();
		expect(data.get('book-doctor:library-pending:v1:account-a')).toBe('pending');
		expect(data.get('book-doctor:library-cache:v2:account-a')).toBe('interactions');
	});
});
