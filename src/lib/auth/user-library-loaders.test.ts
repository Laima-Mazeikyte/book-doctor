import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { get } from 'svelte/store';
import {
	createLibraryLoadCoordinator,
	loadUserLibraryIds,
	loadUserLibraryDetails
} from './user-library-loaders';
import { libraryLoads } from '$lib/stores/libraryLoads';
import { librarySaves } from '$lib/stores/librarySaves';
import { ratingsStore } from '$lib/stores/ratings';
import { planToReadStore } from '$lib/stores/planToRead';
import { notInterestedStore } from '$lib/stores/notInterested';

function reset() {
	ratingsStore.reset();
	planToReadStore.reset();
	notInterestedStore.reset();
}
function client(fetcher: typeof fetch) {
	return createClient('https://library.test', 'public-test-key', {
		db: { retry: false },
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: { fetch: fetcher }
	});
}
function rowsResponse(rows: unknown[]) {
	return Response.json(rows, { headers: { 'content-range': `*/${rows.length}` } });
}

describe('account-safe library loading', () => {
	beforeEach(() => {
		librarySaves.activateOwner('load-A');
		libraryLoads.reset();
		reset();
	});
	afterEach(() => {
		libraryLoads.reset();
		ratingsStore.setPersistence(null);
		reset();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('ignores an old account response even before its load coordinator has been invalidated', async () => {
		let release!: () => void;
		const responseReady = new Promise<void>((resolve) => {
			release = resolve;
		});
		const fetcher = vi.fn<typeof fetch>(async () => {
			await responseReady;
			return rowsResponse([
				{ book_id: 'old-ulid', book_rating: 4, books: { id: 'old-uuid', book_id: 'old-ulid' } }
			]);
		});
		const coordinator = createLibraryLoadCoordinator();
		const requestId = coordinator.nextRequest();
		const loaded = loadUserLibraryIds(client(fetcher), 'load-A', requestId, coordinator);
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
		librarySaves.activateOwner('load-B');
		ratingsStore.hydrate([{ bookId: 'new-uuid', rating: 5 }]);
		planToReadStore.hydrate(['new-uuid']);
		notInterestedStore.hydrate(['new-ulid']);
		release();
		await loaded;
		expect(get(ratingsStore)).toEqual(new Map([['new-uuid', 5]]));
		expect(get(planToReadStore)).toEqual(new Set(['new-uuid']));
		expect(get(notInterestedStore)).toEqual(new Set(['new-ulid']));
	});

	it('preserves the last bookmark and dismissal snapshots when their server reads fail', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		planToReadStore.hydrate(['existing-uuid']);
		notInterestedStore.hydrate(['existing-ulid']);
		const fetcher: typeof fetch = async (input) => {
			const table = new URL(String(input)).pathname.split('/').at(-1);
			return table === 'user_ratings'
				? rowsResponse([])
				: Response.json({ message: 'Denied', code: '42501' }, { status: 403 });
		};
		const coordinator = createLibraryLoadCoordinator();
		await loadUserLibraryIds(client(fetcher), 'load-A', coordinator.nextRequest(), coordinator);
		expect(get(planToReadStore)).toEqual(new Set(['existing-uuid']));
		expect(get(notInterestedStore)).toEqual(new Set(['existing-ulid']));
	});

	it('commits bookmarks and dismissals independently when ratings cannot be loaded', async () => {
		const fetcher: typeof fetch = async (input) => {
			const table = new URL(String(input)).pathname.split('/').at(-1);
			if (table === 'user_ratings') return Response.json({ message: 'Denied' }, { status: 403 });
			if (table === 'user_bookmarks')
				return rowsResponse([
					{ book_id: 'bookmark-ulid', books: { id: 'bookmark-uuid', book_id: 'bookmark-ulid' } }
				]);
			return rowsResponse([{ book_id: 'dismissal-ulid' }]);
		};
		const coordinator = createLibraryLoadCoordinator();
		await loadUserLibraryIds(client(fetcher), 'load-A', coordinator.nextRequest(), coordinator);
		expect(get(libraryLoads).collections.ratings).toMatchObject({
			status: 'error',
			hasSnapshot: false
		});
		expect(get(libraryLoads).collections.bookmarks.status).toBe('ready');
		expect(get(libraryLoads).collections.dismissals.status).toBe('ready');
		expect(get(planToReadStore)).toEqual(new Set(['bookmark-uuid']));
		expect(get(notInterestedStore)).toEqual(new Set(['dismissal-ulid']));
	});

	it('preserves a newer acknowledged rating when an older read completes', async () => {
		let started!: () => void;
		const readStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		let release!: () => void;
		const responseReady = new Promise<void>((resolve) => {
			release = resolve;
		});
		const fetcher: typeof fetch = async (input) => {
			if (new URL(String(input)).pathname.endsWith('/user_ratings')) {
				started();
				await responseReady;
				return rowsResponse([
					{ book_id: 'ulid', book_rating: 4, books: { id: 'uuid', book_id: 'ulid' } }
				]);
			}
			return rowsResponse([]);
		};
		const coordinator = createLibraryLoadCoordinator();
		const loading = loadUserLibraryIds(
			client(fetcher),
			'load-A',
			coordinator.nextRequest(),
			coordinator
		);
		await readStarted;
		ratingsStore.setPersistence({ set: async () => {}, remove: async () => {} }, 'load-A');
		ratingsStore.setRating('uuid', 5, 'ulid');
		await librarySaves.flush();
		release();
		await loading;
		expect(get(ratingsStore).get('uuid')).toBe(5);
		expect(get(librarySaves).queuedCount).toBe(0);
		expect(get(libraryLoads).collections.ratings.status).toBe('ready');
	});

	it('keeps rated book details usable after a failed refresh', async () => {
		const book = { id: 'uuid', book_id: 'ulid', title: 'Cached book', author: 'Author' };
		ratingsStore.hydrate([{ bookId: book.id, rating: 4 }]);
		ratingsStore.setRatedBooksDetails(new Map([[book.id, book]]));
		libraryLoads.markSnapshot('load-A', ['ratedDetails']);
		const coordinator = createLibraryLoadCoordinator();
		await loadUserLibraryDetails(
			client(async () => Response.json({ message: 'Denied' }, { status: 403 })),
			'load-A',
			coordinator.nextRequest(),
			coordinator
		);
		expect(get(libraryLoads).collections.ratedDetails).toMatchObject({
			status: 'error',
			hasSnapshot: true
		});
		expect(get(ratingsStore.ratedBooks)).toEqual([{ book, rating: 4 }]);
	});

	it('loads beyond the API row cap before declaring a collection complete', async () => {
		const dismissed = Array.from({ length: 1007 }, (_, index) => ({ book_id: `ulid-${index}` }));
		const offsets: number[] = [];
		const fetcher: typeof fetch = async (input) => {
			const url = new URL(String(input));
			if (!url.pathname.endsWith('/user_not_interested')) return rowsResponse([]);
			const offset = Number(url.searchParams.get('offset') ?? 0);
			const limit = Number(url.searchParams.get('limit'));
			expect(limit).toBe(500);
			offsets.push(offset);
			// Simulate a configured API cap smaller than the requested page size.
			return Response.json(dismissed.slice(offset, offset + 300), {
				headers: { 'content-range': `*/${dismissed.length}` }
			});
		};
		const coordinator = createLibraryLoadCoordinator();
		await loadUserLibraryIds(client(fetcher), 'load-A', coordinator.nextRequest(), coordinator);
		expect(offsets).toEqual([0, 300, 600, 900]);
		expect(notInterestedStore.getBookIds()).toHaveLength(1007);
		expect(get(libraryLoads).collections.dismissals).toMatchObject({
			status: 'ready',
			hasSnapshot: true
		});
	});

	it('does not publish a partial page when a later page fails', async () => {
		notInterestedStore.hydrate(['cached-ulid']);
		libraryLoads.markSnapshot('load-A', ['dismissals']);
		const fetcher: typeof fetch = async (input) => {
			const url = new URL(String(input));
			if (!url.pathname.endsWith('/user_not_interested')) return rowsResponse([]);
			if (url.searchParams.get('offset') !== '0')
				return Response.json({ message: 'Denied' }, { status: 403 });
			return Response.json([{ book_id: 'partial-ulid' }], { headers: { 'content-range': '*/2' } });
		};
		const coordinator = createLibraryLoadCoordinator();
		await loadUserLibraryIds(client(fetcher), 'load-A', coordinator.nextRequest(), coordinator);
		expect(notInterestedStore.getBookIds()).toEqual(['cached-ulid']);
		expect(get(libraryLoads).collections.dismissals).toMatchObject({
			status: 'error',
			hasSnapshot: true
		});
	});

	it('does not establish completeness without a confirmed total', async () => {
		vi.useFakeTimers();
		const fetcher: typeof fetch = async (input) =>
			new URL(String(input)).pathname.endsWith('/user_not_interested')
				? Response.json([])
				: rowsResponse([]);
		const coordinator = createLibraryLoadCoordinator();
		const loading = loadUserLibraryIds(
			client(fetcher),
			'load-A',
			coordinator.nextRequest(),
			coordinator
		);
		await vi.runAllTimersAsync();
		await loading;
		expect(get(libraryLoads).collections.dismissals).toMatchObject({
			status: 'error',
			hasSnapshot: false
		});
	});
});
