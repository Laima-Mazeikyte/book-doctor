import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	clearLibraryCache,
	readLibraryCache,
	writeLibraryCache,
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
});
