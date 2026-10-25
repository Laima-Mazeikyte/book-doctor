import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	clearLibraryCache,
	readLibraryCache,
	writeLibraryCache,
	readLibrarySnapshot,
	writeLibrarySnapshot,
	LIBRARY_SNAPSHOT_PREFIX,
	type CachedRatedBook
} from './libraryCache';

function makeLocalStorage() {
	const store = new Map<string, string>();
	return {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => {
			store.set(k, v);
		},
		removeItem: (k: string) => {
			store.delete(k);
		},
		key: (i: number) => Array.from(store.keys())[i] ?? null,
		get length() {
			return store.size;
		}
	};
}

const KEY = (userId: string) => `book-doctor:library-cache:v1:${userId}`;

const sample: CachedRatedBook[] = [
	{ id: 'u1', book_id: 'B1', title: 'Dune', author: 'Herbert', rating: 5 },
	{ id: 'u2', book_id: 'B2', title: 'Neuromancer', author: 'Gibson', rating: 4 }
];

describe('library cache', () => {
	let ls: ReturnType<typeof makeLocalStorage>;

	beforeEach(() => {
		ls = makeLocalStorage();
		vi.stubGlobal('window', { localStorage: ls });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('round-trips a snapshot', () => {
		writeLibraryCache('user-1', sample);
		expect(readLibraryCache('user-1')).toEqual(sample);
	});

	it('returns null on cache miss', () => {
		expect(readLibraryCache('nobody')).toBeNull();
	});

	it('isolates caches per user', () => {
		writeLibraryCache('user-1', sample);
		expect(readLibraryCache('user-2')).toBeNull();
	});

	it('drops malformed entries but keeps valid ones', () => {
		ls.setItem(
			KEY('user-1'),
			JSON.stringify([
				sample[0],
				{ id: 'x', book_id: 'B', title: 'T', author: 'A', rating: 9 }, // rating out of range
				{ id: 'y' }, // missing fields
				'garbage'
			])
		);
		expect(readLibraryCache('user-1')).toEqual([sample[0]]);
	});

	it('returns null on non-JSON or non-array payloads', () => {
		ls.setItem(KEY('user-1'), 'not json');
		ls.setItem(KEY('user-2'), JSON.stringify({ not: 'an array' }));
		expect(readLibraryCache('user-1')).toBeNull();
		expect(readLibraryCache('user-2')).toBeNull();
	});

	it('clears a single user, leaving others', () => {
		writeLibraryCache('user-1', sample);
		writeLibraryCache('user-2', sample);
		clearLibraryCache('user-1');
		expect(readLibraryCache('user-1')).toBeNull();
		expect(readLibraryCache('user-2')).toEqual(sample);
	});

	it('clears every library cache (but not other keys) when no user is given', () => {
		writeLibraryCache('user-1', sample);
		writeLibraryCache('user-2', sample);
		ls.setItem('book-doctor:not-interested:v2', 'keep me');
		clearLibraryCache();
		expect(readLibraryCache('user-1')).toBeNull();
		expect(readLibraryCache('user-2')).toBeNull();
		expect(ls.getItem('book-doctor:not-interested:v2')).toBe('keep me');
	});

	it('ignores null/undefined userId without writing', () => {
		expect(readLibraryCache(null)).toBeNull();
		writeLibraryCache(undefined, sample);
		expect(ls.length).toBe(0);
	});

	it('distinguishes missing collections from complete empty collections', () => {
		writeLibrarySnapshot('user-1', { bookmarks: [], dismissals: [] });
		expect(readLibrarySnapshot('user-1')).toEqual({ bookmarks: [], dismissals: [] });
		expect(readLibrarySnapshot('user-2')).toEqual({});
	});

	it('merges successful collections without erasing unavailable ones', () => {
		writeLibrarySnapshot('user-1', {
			dismissals: ['B1'],
			bookmarks: [{ id: 'u2', book_id: 'B2' }]
		});
		writeLibrarySnapshot('user-1', { ratings: { entries: sample, books: sample } });
		writeLibrarySnapshot('user-1', { bookmarks: [] });
		expect(readLibrarySnapshot('user-1')).toEqual({
			ratings: { entries: sample, books: sample },
			bookmarks: [],
			dismissals: ['B1']
		});
	});

	it.each([
		{
			bad: [
				{ id: 'u1', book_id: 'B1' },
				{ id: 'u1', book_id: 'B2' }
			]
		},
		{
			bad: [
				{ id: 'u1', book_id: 'B1' },
				{ id: 'u2', book_id: 'B1' }
			]
		},
		{ bad: [{ id: 'u1' }] },
		{ bad: ['garbage'] }
	])(
		'rejects a malformed collection as a whole while retaining independent valid data: %j',
		({ bad }) => {
			ls.setItem(
				LIBRARY_SNAPSHOT_PREFIX + 'user-1',
				JSON.stringify({
					version: 2,
					ownerId: 'user-1',
					collections: { bookmarks: bad, dismissals: [] }
				})
			);
			expect(readLibrarySnapshot('user-1')).toEqual({ dismissals: [] });
		}
	);

	it('rejects mismatched rating details and incompatible owners/versions', () => {
		const key = LIBRARY_SNAPSHOT_PREFIX + 'user-1';
		ls.setItem(
			key,
			JSON.stringify({
				version: 2,
				ownerId: 'user-1',
				collections: {
					ratings: { entries: sample, books: [{ ...sample[0], rating: 1 }] },
					bookmarks: []
				}
			})
		);
		expect(readLibrarySnapshot('user-1')).toEqual({ bookmarks: [] });
		for (const envelope of [
			{ version: 1, ownerId: 'user-1' },
			{ version: 2, ownerId: 'user-2' }
		]) {
			ls.setItem(key, JSON.stringify({ ...envelope, collections: { dismissals: [] } }));
			expect(readLibrarySnapshot('user-1')).toEqual({});
		}
	});

	it('clears both cache versions for one account while preserving pending journals and other accounts', () => {
		writeLibraryCache('user-1', sample);
		writeLibrarySnapshot('user-1', { bookmarks: [] });
		writeLibrarySnapshot('user-2', { dismissals: ['B2'] });
		ls.setItem('book-doctor:library-pending:v1:user-1', 'durable');
		clearLibraryCache('user-1');
		expect(readLibraryCache('user-1')).toBeNull();
		expect(readLibrarySnapshot('user-1')).toEqual({});
		expect(readLibrarySnapshot('user-2')).toEqual({ dismissals: ['B2'] });
		expect(ls.getItem('book-doctor:library-pending:v1:user-1')).toBe('durable');
	});

	it('tolerates storage failures and bounds stored payload sizes', () => {
		ls.setItem(LIBRARY_SNAPSHOT_PREFIX + 'user-1', ' '.repeat(4_000_001));
		expect(readLibrarySnapshot('user-1')).toEqual({});
		vi.spyOn(ls, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		expect(() => writeLibrarySnapshot('user-1', { dismissals: [] })).not.toThrow();
		vi.spyOn(ls, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(readLibrarySnapshot('user-1')).toEqual({});
	});
});
