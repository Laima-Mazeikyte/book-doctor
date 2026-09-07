import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import {
	authInitStore,
	authStore,
	markAuthInitChecking,
	markAuthInitReady
} from '$lib/stores/auth';
import { notInterestedStore } from '$lib/stores/notInterested';
import { notInterestedPageLoader } from './pageLoader';

const book = {
	id: 'uuid-1',
	book_id: 'ni-1',
	title: 'Book one',
	author: 'Author'
};

function response(data: unknown): Response {
	return {
		ok: true,
		json: async () => data
	} as Response;
}

function setSession(userId = 'user-1', token = 'token-1'): void {
	authStore.setSession({
		access_token: token,
		user: { id: userId }
	} as Session);
}

beforeEach(() => {
	notInterestedPageLoader.reset();
	notInterestedStore.reset();
	vi.stubGlobal('fetch', vi.fn());
	authInitStore.set({ status: 'ready' });
	setSession();
	notInterestedPageLoader.reset();
});

afterEach(() => {
	vi.unstubAllGlobals();
	authStore.setSession(null);
	authInitStore.set({ status: 'idle' });
});

describe('not interested page loader', () => {
	it('waits for auth restoration and deduplicates the first page request', async () => {
		const fetchMock = vi.mocked(fetch);
		let resolveResponse: (value: Response) => void = () => undefined;
		const pendingResponse = new Promise<Response>((resolve) => {
			resolveResponse = resolve;
		});
		fetchMock.mockReturnValue(pendingResponse);
		markAuthInitChecking();

		const first = notInterestedPageLoader.ensureLoaded('newest');
		const second = notInterestedPageLoader.ensureLoaded('newest');
		await Promise.resolve();
		expect(fetchMock).not.toHaveBeenCalled();

		markAuthInitReady();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		resolveResponse(response({ books: [book], nextCursor: 'cursor-1' }));
		await Promise.all([first, second]);

		expect(notInterestedPageLoader.getSnapshot('newest')).toMatchObject({
			books: [book],
			nextCursor: 'cursor-1',
			loaded: true,
			loading: false,
			error: null
		});
	});

	it('keeps a successful page and cursor when loading more fails, then retries that page', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock
			.mockResolvedValueOnce(response({ books: [book], nextCursor: 'cursor-1' }))
			.mockResolvedValueOnce({ ok: false } as Response)
			.mockResolvedValueOnce(
				response({ books: [{ ...book, id: 'uuid-2', book_id: 'ni-2' }], nextCursor: null })
			);

		await notInterestedPageLoader.ensureLoaded('newest');
		await notInterestedPageLoader.loadMore('newest');
		expect(notInterestedPageLoader.getSnapshot('newest')).toMatchObject({
			books: [book],
			nextCursor: 'cursor-1',
			loaded: true,
			loading: false
		});
		expect(notInterestedPageLoader.getSnapshot('newest').error).toBeTruthy();

		await notInterestedPageLoader.retry('newest');
		expect(notInterestedPageLoader.getSnapshot('newest').books).toHaveLength(2);
		expect(notInterestedPageLoader.getSnapshot('newest').nextCursor).toBeNull();
	});

	it('ignores a response that belongs to a previous account', async () => {
		const fetchMock = vi.mocked(fetch);
		let resolveResponse: (value: Response) => void = () => undefined;
		fetchMock.mockReturnValue(
			new Promise<Response>((resolve) => {
				resolveResponse = resolve;
			})
		);

		const load = notInterestedPageLoader.ensureLoaded('newest');
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		setSession('user-2', 'token-2');
		resolveResponse(response({ books: [book], nextCursor: null }));
		await load;

		expect(notInterestedPageLoader.getSnapshot('newest')).toEqual({
			books: [],
			nextCursor: null,
			loaded: false,
			loading: false,
			error: null
		});
	});

	it('removes restored books while preserving the page cursor', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockResolvedValue(response({ books: [book], nextCursor: 'cursor-1' }));
		notInterestedStore.hydrate(['ni-1']);
		await notInterestedPageLoader.ensureLoaded('newest');

		notInterestedStore.remove('ni-1');
		expect(notInterestedPageLoader.getSnapshot('newest')).toMatchObject({
			books: [],
			nextCursor: 'cursor-1',
			loaded: true
		});
	});

	it('clears a removal when a book is re-added before the tab first loads', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockResolvedValue(response({ books: [book], nextCursor: null }));
		notInterestedStore.hydrate(['ni-1']);
		notInterestedStore.remove('ni-1');
		notInterestedStore.add('ni-1');

		await notInterestedPageLoader.ensureLoaded('newest');

		expect(notInterestedStore.has('ni-1')).toBe(true);
		expect(notInterestedPageLoader.getSnapshot('newest')).toMatchObject({
			books: [book],
			loaded: true,
			loading: false,
			error: null
		});
	});

	it('does not discard the initial request when the dismissed-ID store hydrates', async () => {
		const fetchMock = vi.mocked(fetch);
		let resolveResponse: (value: Response) => void = () => undefined;
		fetchMock.mockReturnValue(
			new Promise<Response>((resolve) => {
				resolveResponse = resolve;
			})
		);

		const load = notInterestedPageLoader.ensureLoaded('newest');
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		notInterestedStore.hydrate(['ni-1']);

		resolveResponse(response({ books: [book], nextCursor: null }));
		await load;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(notInterestedPageLoader.getSnapshot('newest')).toMatchObject({
			books: [book],
			loaded: true,
			loading: false,
			error: null
		});
	});

	it('restarts an initial request invalidated by a new dismissal', async () => {
		const fetchMock = vi.mocked(fetch);
		let resolveInitial: (value: Response) => void = () => undefined;
		let resolveReplacement: (value: Response) => void = () => undefined;
		fetchMock
			.mockReturnValueOnce(
				new Promise<Response>((resolve) => {
					resolveInitial = resolve;
				})
			)
			.mockReturnValueOnce(
				new Promise<Response>((resolve) => {
					resolveReplacement = resolve;
				})
			);

		const load = notInterestedPageLoader.ensureLoaded('newest');
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		notInterestedStore.add('ni-new');
		resolveInitial(response({ books: [book], nextCursor: null }));
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		resolveReplacement(response({ books: [], nextCursor: null }));
		await load;

		expect(notInterestedPageLoader.getSnapshot('newest')).toMatchObject({
			books: [],
			loaded: true,
			loading: false,
			error: null
		});
	});

	it('preserves a successful cache when a stale first-page refresh fails', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock
			.mockResolvedValueOnce(response({ books: [book], nextCursor: 'cursor-1' }))
			.mockResolvedValueOnce({ ok: false } as Response);

		await notInterestedPageLoader.ensureLoaded('newest');
		notInterestedPageLoader.invalidate('newest');
		await notInterestedPageLoader.ensureLoaded('newest');

		expect(notInterestedPageLoader.getSnapshot('newest')).toMatchObject({
			books: [book],
			nextCursor: 'cursor-1',
			loaded: true,
			loading: false
		});
		expect(notInterestedPageLoader.getSnapshot('newest').error).toBeTruthy();
	});

	it('filters a removed book from a next page that was already in flight', async () => {
		const fetchMock = vi.mocked(fetch);
		let resolveNextPage: (value: Response) => void = () => undefined;
		fetchMock
			.mockResolvedValueOnce(response({ books: [book], nextCursor: 'cursor-1' }))
			.mockReturnValueOnce(
				new Promise<Response>((resolve) => {
					resolveNextPage = resolve;
				})
			);
		notInterestedStore.hydrate(['ni-1', 'ni-2']);

		await notInterestedPageLoader.ensureLoaded('newest');
		const loadMore = notInterestedPageLoader.loadMore('newest');
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		notInterestedStore.remove('ni-2');
		resolveNextPage(
			response({
				books: [{ ...book, id: 'uuid-2', book_id: 'ni-2', title: 'Book two' }],
				nextCursor: null
			})
		);
		await loadMore;

		expect(notInterestedStore.has('ni-2')).toBe(false);
		expect(notInterestedPageLoader.getSnapshot('newest').books).toEqual([book]);
	});
});
