import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Session } from '@supabase/supabase-js';
import ShortlistPage from '../../routes/rate/recommendations/shortlist/+page.svelte';
import { authStore, markAuthInitReady } from '$lib/stores/auth';
import { libraryLoads } from '$lib/stores/libraryLoads';
import { librarySaves } from '$lib/stores/librarySaves';
import { notInterestedStore } from '$lib/stores/notInterested';
import { recommendationsPageStore } from '$lib/stores/recommendationsPage';

const pageState = vi.hoisted(() => ({
	url: new URL('http://localhost/rate/recommendations/shortlist?request_id=42')
}));

vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), beforeNavigate: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/stores/recommendationsCount', () => ({
	refreshRecommendationsCountFromApi: vi.fn()
}));

function session(userId: string, accessToken: string): Session {
	return { access_token: accessToken, user: { id: userId } } as Session;
}

function recommendationsResponse(title: string) {
	return {
		ok: true,
		status: 200,
		json: async () => ({
			books: [{ id: `${title}-id`, book_id: `${title}-book`, title, author: 'Author' }],
			request_id: '42'
		})
	};
}

describe('shortlist page auth loading', () => {
	beforeEach(() => {
		pageState.url = new URL('http://localhost/rate/recommendations/shortlist?request_id=42');
		authStore.setSession(null);
		recommendationsPageStore.ensureUser(null);
		recommendationsPageStore.reset();
		notInterestedStore.reset();
		libraryLoads.reset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('restarts with an access token when the session is restored after mounting', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 401 })
			.mockResolvedValue(recommendationsResponse('Restored recommendation'));
		vi.stubGlobal('fetch', fetchMock);

		const rendered = render(ShortlistPage);
		await expect
			.element(rendered.getByRole('alert'))
			.toHaveTextContent('Couldn’t load your recommendations.');
		expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/recommendations?request_id=42', {
			headers: {}
		});

		authStore.setSession(session('user-1', 'token-1'));
		await expect
			.element(rendered.getByRole('heading', { name: 'Restored recommendation', exact: true }))
			.toBeVisible();
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/recommendations?request_id=42', {
			headers: { Authorization: 'Bearer token-1' }
		});
		expect(recommendationsPageStore.getRun('42')?.books[0]?.title).toBe('Restored recommendation');
		rendered.unmount();
	});

	it('changes the message at six seconds even while a read is pending, then shows its results', async () => {
		vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
		let resolveResponse!: (response: ReturnType<typeof recommendationsResponse>) => void;
		const pendingResponse = new Promise<ReturnType<typeof recommendationsResponse>>((resolve) => {
			resolveResponse = resolve;
		});
		const fetchMock = vi.fn().mockReturnValue(pendingResponse);
		vi.stubGlobal('fetch', fetchMock);
		authStore.setSession(session('user-1', 'token-1'));

		const rendered = render(ShortlistPage);
		await tick();
		await expect.element(rendered.getByText('Finding books for you…')).toBeVisible();
		await vi.advanceTimersByTimeAsync(5999);
		await expect.element(rendered.getByText('Finding books for you…')).toBeVisible();
		await expect.element(rendered.getByText('Taking longer than usual.')).not.toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(1);
		await expect.element(rendered.getByText('Taking longer than usual.')).toBeVisible();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		resolveResponse(recommendationsResponse('Delayed recommendation'));
		await expect
			.element(rendered.getByRole('heading', { name: 'Delayed recommendation', exact: true }))
			.toBeVisible();
		await expect.element(rendered.getByText('Taking longer than usual.')).not.toBeInTheDocument();
		rendered.unmount();
	});

	it('keeps polling after the slower message and retains the existing failure timeout', async () => {
		vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ books: [], request_id: '42' })
		});
		vi.stubGlobal('fetch', fetchMock);
		authStore.setSession(session('user-1', 'token-1'));

		const rendered = render(ShortlistPage);
		await tick();
		await vi.advanceTimersByTimeAsync(6000);
		await expect.element(rendered.getByText('Taking longer than usual.')).toBeVisible();
		const readsAtSixSeconds = fetchMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(13000);
		await expect.element(rendered.getByText('Taking longer than usual.')).toBeVisible();
		expect(fetchMock.mock.calls.length).toBeGreaterThan(readsAtSixSeconds);
		await vi.advanceTimersByTimeAsync(2000);
		await expect
			.element(rendered.getByRole('alert'))
			.toHaveTextContent('Could not generate your shortlist');
		await expect
			.element(rendered.getByRole('button', { name: 'Check again', exact: true }))
			.not.toBeInTheDocument();
		const readsAtTimeout = fetchMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(6000);
		expect(fetchMock).toHaveBeenCalledTimes(readsAtTimeout);
		rendered.unmount();
	});

	it.each([true, false])('ignores a previous account refresh (successful: %s)', async (success) => {
		let resolveFirst!: (response: ReturnType<typeof recommendationsResponse>) => void;
		const firstResponse = new Promise<ReturnType<typeof recommendationsResponse>>((resolve) => {
			resolveFirst = resolve;
		});
		const fetchMock = vi
			.fn()
			.mockReturnValueOnce(firstResponse)
			.mockResolvedValue(recommendationsResponse('Second account recommendation'));
		vi.stubGlobal('fetch', fetchMock);
		authStore.setSession(session('user-1', 'token-1'));
		recommendationsPageStore.ensureUser('user-1');
		recommendationsPageStore.setRun('42', {
			books: [
				{ id: 'cached-id', book_id: 'cached-book', title: 'Cached first account', author: 'Author' }
			],
			likedBookPrecedentsByBookId: {},
			authorRelationshipAuthorsByBookId: {},
			dimensionMatchSnapshotsByBookId: {}
		});
		pageState.url.searchParams.set('from', 'history');

		const rendered = render(ShortlistPage);
		await expect
			.element(rendered.getByRole('heading', { name: 'Cached first account', exact: true }))
			.toBeVisible();

		authStore.setSession(session('user-2', 'token-2'));
		await expect
			.element(
				rendered.getByRole('heading', { name: 'Second account recommendation', exact: true })
			)
			.toBeVisible();
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/recommendations?request_id=42', {
			headers: { Authorization: 'Bearer token-2' }
		});
		expect(document.body.textContent).not.toContain('Cached first account');

		resolveFirst({
			...recommendationsResponse('Late first account recommendation'),
			ok: success,
			status: success ? 200 : 500
		});
		await firstResponse;
		await new Promise(requestAnimationFrame);
		await tick();
		expect(recommendationsPageStore.getRun('42')?.books[0]?.title).toBe(
			'Second account recommendation'
		);
		expect(document.body.textContent).not.toContain('Late first account recommendation');
		await expect.element(rendered.getByRole('alert')).not.toBeInTheDocument();
		rendered.unmount();
	});

	it('preserves a dismissal and its replacement option during retry and after refresh', async () => {
		authStore.setSession(session('user-1', 'token-1'));
		markAuthInitReady();
		librarySaves.activateOwner('user-1');
		libraryLoads.markSnapshot('user-1', ['ratings', 'bookmarks', 'dismissals']);
		recommendationsPageStore.ensureUser('user-1');
		const books = Array.from({ length: 8 }, (_, index) => ({
			id: `book-${index}`,
			book_id: `ulid-${index}`,
			title: `Book ${index}`,
			author: 'Author'
		}));
		recommendationsPageStore.setRun('42', {
			books,
			likedBookPrecedentsByBookId: {},
			authorRelationshipAuthorsByBookId: {},
			dimensionMatchSnapshotsByBookId: {}
		});
		pageState.url.searchParams.set('from', 'history');
		let resolveRetry!: (response: { ok: boolean; json: () => Promise<unknown> }) => void;
		const retryResponse = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
			resolveRetry = resolve;
		});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 500 })
			.mockReturnValueOnce(retryResponse);
		vi.stubGlobal('fetch', fetchMock);

		const rendered = render(ShortlistPage);
		await expect
			.element(rendered.getByRole('alert'))
			.toHaveTextContent('Couldn’t load your recommendations.');
		await rendered.getByRole('button', { name: 'Not interested', exact: true }).click();
		await expect
			.element(rendered.getByRole('button', { name: 'Get another book', exact: true }))
			.toBeVisible();
		await rendered.getByRole('button', { name: 'Retry', exact: true }).click();
		await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
		await expect
			.element(rendered.getByRole('button', { name: 'Get another book', exact: true }))
			.toBeVisible();

		resolveRetry({ ok: true, json: async () => ({ books, request_id: '42' }) });
		await expect.element(rendered.getByRole('alert')).not.toBeInTheDocument();
		await expect
			.element(rendered.getByRole('button', { name: 'Get another book', exact: true }))
			.toBeVisible();
		expect(notInterestedStore.has('ulid-0')).toBe(true);
		rendered.unmount();
		notInterestedStore.reset();
		libraryLoads.reset();
	});

	it('ignores a pending account response after sign-out', async () => {
		let resolveFirst!: (response: ReturnType<typeof recommendationsResponse>) => void;
		const firstResponse = new Promise<ReturnType<typeof recommendationsResponse>>((resolve) => {
			resolveFirst = resolve;
		});
		const fetchMock = vi
			.fn()
			.mockReturnValueOnce(firstResponse)
			.mockResolvedValue({ ok: false, status: 401 });
		vi.stubGlobal('fetch', fetchMock);
		authStore.setSession(session('user-1', 'token-1'));

		const rendered = render(ShortlistPage);
		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		authStore.setSession(null);
		await expect
			.element(rendered.getByRole('alert'))
			.toHaveTextContent('Couldn’t load your recommendations.');
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/recommendations?request_id=42', {
			headers: {}
		});

		resolveFirst(recommendationsResponse('Signed out account recommendation'));
		await firstResponse;
		await new Promise(requestAnimationFrame);
		await tick();
		expect(recommendationsPageStore.getRun('42')).toBeUndefined();
		expect(document.body.textContent).not.toContain('Signed out account recommendation');
		await expect
			.element(rendered.getByRole('alert'))
			.toHaveTextContent('Couldn’t load your recommendations.');
		rendered.unmount();
	});

	it('retries a failed load with the active account', async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error('Network unavailable'))
			.mockResolvedValue(recommendationsResponse('Retried recommendation'));
		vi.stubGlobal('fetch', fetchMock);
		authStore.setSession(session('user-1', 'token-1'));

		const rendered = render(ShortlistPage);
		await expect
			.element(rendered.getByRole('alert'))
			.toHaveTextContent('Couldn’t load your recommendations.');
		await rendered.getByRole('button', { name: 'Retry', exact: true }).click();
		await expect
			.element(rendered.getByRole('heading', { name: 'Retried recommendation', exact: true }))
			.toBeVisible();
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/recommendations?request_id=42', {
			headers: { Authorization: 'Bearer token-1' }
		});
		expect(recommendationsPageStore.getRun('42')?.books[0]?.title).toBe('Retried recommendation');
		rendered.unmount();
	});

	it('keeps a cached shortlist visible when refreshing fails and while retrying', async () => {
		authStore.setSession(session('user-1', 'token-1'));
		recommendationsPageStore.ensureUser('user-1');
		recommendationsPageStore.setRun('42', {
			books: [
				{ id: 'cached-id', book_id: 'cached-book', title: 'Cached shortlist', author: 'Author' }
			],
			likedBookPrecedentsByBookId: {},
			authorRelationshipAuthorsByBookId: {},
			dimensionMatchSnapshotsByBookId: {}
		});
		pageState.url.searchParams.set('from', 'history');
		let resolveRetry!: (response: ReturnType<typeof recommendationsResponse>) => void;
		const retryResponse = new Promise<ReturnType<typeof recommendationsResponse>>((resolve) => {
			resolveRetry = resolve;
		});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 500 })
			.mockReturnValueOnce(retryResponse);
		vi.stubGlobal('fetch', fetchMock);

		const rendered = render(ShortlistPage);
		await expect
			.element(rendered.getByRole('alert'))
			.toHaveTextContent('Couldn’t load your recommendations.');
		await expect
			.element(rendered.getByRole('heading', { name: 'Cached shortlist', exact: true }))
			.toBeVisible();
		expect(recommendationsPageStore.getRun('42')?.books[0]?.title).toBe('Cached shortlist');

		await rendered.getByRole('button', { name: 'Retry', exact: true }).click();
		await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
		await expect
			.element(rendered.getByRole('heading', { name: 'Cached shortlist', exact: true }))
			.toBeVisible();
		resolveRetry(recommendationsResponse('Refreshed shortlist'));
		await expect
			.element(rendered.getByRole('heading', { name: 'Refreshed shortlist', exact: true }))
			.toBeVisible();
		await expect.element(rendered.getByRole('alert')).not.toBeInTheDocument();
		rendered.unmount();
	});
});
