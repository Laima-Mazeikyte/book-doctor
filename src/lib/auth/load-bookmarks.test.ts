import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { get } from 'svelte/store';
import { loadBookmarkDetails } from './load-bookmarks';
import { authStore } from '$lib/stores/auth';
import { bookmarksPageStore } from '$lib/stores/bookmarksPage';
import { libraryLoads } from '$lib/stores/libraryLoads';
import { librarySaves } from '$lib/stores/librarySaves';
import { planToReadStore } from '$lib/stores/planToRead';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
const book = { id: 'uuid', book_id: 'ulid', title: 'Saved book', author: 'Author' };
function activate(userId: string) {
	librarySaves.activateOwner(userId);
	authStore.setSession({ user: { id: userId }, access_token: `token-${userId}` } as Session);
}

describe('shared bookmark details', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		activate('A');
		libraryLoads.reset();
		planToReadStore.reset();
		bookmarksPageStore.reset();
	});
	afterEach(() => {
		libraryLoads.reset();
		planToReadStore.setPersistence(null);
		planToReadStore.reset();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('shares requests and retains cached books through a failed refresh', async () => {
		const fetcher = vi.fn().mockResolvedValue(Response.json({ books: [book] }));
		vi.stubGlobal('fetch', fetcher);
		const first = loadBookmarkDetails('A');
		const second = loadBookmarkDetails('A');
		await Promise.all([first, second]);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(bookmarksPageStore.getSnapshot().books).toEqual([book]);
		fetcher.mockImplementation(async () => Response.json({}, { status: 503 }));
		const refresh = loadBookmarkDetails('A', true);
		await vi.advanceTimersByTimeAsync(8000);
		await refresh;
		expect(fetcher).toHaveBeenCalledTimes(5);
		expect(bookmarksPageStore.getSnapshot().books).toEqual([book]);
		expect(get(libraryLoads).collections.bookmarkDetails).toMatchObject({
			status: 'error',
			hasSnapshot: true
		});
	});

	it('keeps an old account response out of the new account cache', async () => {
		let release!: (response: Response) => void;
		const response = new Promise<Response>((resolve) => {
			release = resolve;
		});
		const fetcher = vi
			.fn()
			.mockReturnValueOnce(response)
			.mockResolvedValue(Response.json({ books: [] }));
		vi.stubGlobal('fetch', fetcher);
		const old = loadBookmarkDetails('A');
		activate('B');
		await loadBookmarkDetails('B');
		release(Response.json({ books: [book] }));
		await old;
		await vi.advanceTimersByTimeAsync(0);
		expect(bookmarksPageStore.getSnapshot()).toMatchObject({
			userId: 'B',
			loaded: true,
			books: []
		});
	});

	it('preserves a bookmark saved after the read began, even when its queue entry is already acknowledged', async () => {
		let release!: (response: Response) => void;
		const response = new Promise<Response>((resolve) => {
			release = resolve;
		});
		vi.stubGlobal('fetch', vi.fn().mockReturnValue(response));
		const loading = loadBookmarkDetails('A');
		planToReadStore.setPersistence({ add: async () => {}, remove: async () => {} }, 'A');
		planToReadStore.toggle(book.id, book.book_id, book);
		await librarySaves.flush();
		expect(get(librarySaves).queuedCount).toBe(0);
		release(Response.json({ books: [] }));
		await loading;
		expect(bookmarksPageStore.getSnapshot().books).toEqual([book]);
	});
});
