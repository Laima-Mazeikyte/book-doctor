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
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: { fetch: fetcher }
	});
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
	});

	it('ignores an old account response even before its load coordinator has been invalidated', async () => {
		let release!: () => void;
		const responseReady = new Promise<void>((resolve) => {
			release = resolve;
		});
		const fetcher = vi.fn<typeof fetch>(async () => {
			await responseReady;
			return Response.json([
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
				? Response.json([])
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
				return Response.json([
					{ book_id: 'bookmark-ulid', books: { id: 'bookmark-uuid', book_id: 'bookmark-ulid' } }
				]);
			return Response.json([{ book_id: 'dismissal-ulid' }]);
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
				return Response.json([
					{ book_id: 'ulid', book_rating: 4, books: { id: 'uuid', book_id: 'ulid' } }
				]);
			}
			return Response.json([]);
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
});
