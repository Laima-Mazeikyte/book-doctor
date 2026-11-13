import { page as browserPage } from 'vitest/browser';
import '../../app.css';
import { flavorFixture } from './flavorGroups.fixture';
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
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn(),
	beforeNavigate: vi.fn(),
	invalidateAll: vi.fn(),
	preloadData: vi.fn().mockResolvedValue({ status: 200 })
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path, assets: '', base: '' }));
vi.mock('$app/stores', () => ({
	page: {
		subscribe(run: (value: unknown) => void) {
			run({ url: pageState.url, state: {} });
			return () => {};
		}
	}
}));
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
			request_id: '42',
			flavor_groups: flavorFixture([{ book_id: `${title}-book`, rank: 1 }]),
			status: 'completed'
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
			headers: {},
			signal: expect.any(AbortSignal)
		});

		authStore.setSession(session('user-1', 'token-1'));
		await expect
			.element(rendered.getByRole('button', { name: /Restored recommendation/ }))
			.toBeVisible();
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/recommendations?request_id=42', {
			headers: { Authorization: 'Bearer token-1' },
			signal: expect.any(AbortSignal)
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
			.element(rendered.getByRole('button', { name: /Delayed recommendation/ }))
			.toBeVisible();
		await expect.element(rendered.getByText('Taking longer than usual.')).not.toBeInTheDocument();
		rendered.unmount();
	});

	it('shows backend failure separately from timeout and stops polling a terminal request', async () => {
		vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
		authStore.setSession(session('user-1', 'token-1'));
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				books: [],
				request_id: '42',
				status: 'failed',
				error_code: 'recommendation_failed',
				flavor_groups: null
			})
		});
		vi.stubGlobal('fetch', fetchMock);
		const rendered = render(ShortlistPage);
		await tick();
		await expect
			.element(rendered.getByRole('alert'))
			.toHaveTextContent('[COPY: recommendation-generation-failed-title]');
		await expect
			.element(
				rendered.getByRole('button', {
					name: '[COPY: recommendation-generation-failed-action]',
					exact: true
				})
			)
			.toBeVisible();
		await vi.advanceTimersByTimeAsync(25000);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(document.body.textContent).not.toContain(
			'Your shortlist is taking longer than expected'
		);
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
			.toHaveTextContent('Your shortlist is taking longer than expected');
		await expect
			.element(rendered.getByRole('button', { name: 'Check again', exact: true }))
			.toBeVisible();
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
			flavor_groups: flavorFixture([{ book_id: 'cached-book', rank: 1 }]),
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
			.element(rendered.getByRole('button', { name: /Cached first account/ }))
			.toBeVisible();

		authStore.setSession(session('user-2', 'token-2'));
		await expect
			.element(rendered.getByRole('button', { name: /Second account recommendation/ }))
			.toBeVisible();
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/recommendations?request_id=42', {
			headers: { Authorization: 'Bearer token-2' },
			signal: expect.any(AbortSignal)
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

	it('grays out a dismissed book without replacement or removing its group', async () => {
		authStore.setSession(session('user-1', 'token-1'));
		markAuthInitReady();
		librarySaves.activateOwner('user-1');
		libraryLoads.markSnapshot('user-1', ['ratings', 'bookmarks', 'dismissals']);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(recommendationsResponse('Dismiss me')));
		const rendered = render(ShortlistPage);
		await rendered.getByRole('button', { name: /Dismiss me/ }).click();
		await rendered.getByRole('button', { name: 'Not interested', exact: true }).click();
		expect(notInterestedStore.has('Dismiss me-book')).toBe(true);
		expect(document.body.textContent).not.toContain('Get another book');
		expect(document.querySelectorAll('.group-track > .group-slide')).toHaveLength(12);
		expect(document.querySelector('.book-card__media-inner--not-interested')).not.toBeNull();
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
			headers: {},
			signal: expect.any(AbortSignal)
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
			.element(rendered.getByRole('button', { name: /Retried recommendation/ }))
			.toBeVisible();
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/recommendations?request_id=42', {
			headers: { Authorization: 'Bearer token-1' },
			signal: expect.any(AbortSignal)
		});
		expect(recommendationsPageStore.getRun('42')?.books[0]?.title).toBe('Retried recommendation');
		rendered.unmount();
	});

	it('keeps a cached shortlist visible when refreshing fails and while retrying', async () => {
		authStore.setSession(session('user-1', 'token-1'));
		recommendationsPageStore.ensureUser('user-1');
		recommendationsPageStore.setRun('42', {
			flavor_groups: flavorFixture([{ book_id: 'cached-book', rank: 1 }]),
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
		await expect.element(rendered.getByRole('button', { name: /Cached shortlist/ })).toBeVisible();
		expect(recommendationsPageStore.getRun('42')?.books[0]?.title).toBe('Cached shortlist');

		await rendered.getByRole('button', { name: 'Retry', exact: true }).click();
		await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
		await expect.element(rendered.getByRole('button', { name: /Cached shortlist/ })).toBeVisible();
		resolveRetry(recommendationsResponse('Refreshed shortlist'));
		await expect
			.element(rendered.getByRole('button', { name: /Refreshed shortlist/ }))
			.toBeVisible();
		await expect.element(rendered.getByRole('alert')).not.toBeInTheDocument();
		rendered.unmount();
	});
	it('keeps empty groups navigable and loops between the first and last group', async () => {
		authStore.setSession(session('user-1', 'token-1'));
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(recommendationsResponse('Overall book')));
		const rendered = render(ShortlistPage);
		await expect.element(rendered.getByRole('button', { name: /Overall book/ })).toBeVisible();
		await rendered.getByRole('button', { name: '[COPY: previous-group]', exact: true }).click();
		await expect
			.element(rendered.getByRole('heading', { name: '[COPY: group-label:lighter]', exact: true }))
			.toBeVisible();
		await expect
			.element(rendered.getByRole('group', { name: '[COPY: group-position] 10/10', exact: true }))
			.toBeVisible();
		expect(document.querySelector('.group-slide[aria-hidden="false"]')?.textContent).toContain(
			'[COPY: empty-group]'
		);
		await rendered.getByRole('button', { name: '[COPY: next-group]', exact: true }).click();
		await expect.element(rendered.getByRole('button', { name: /Overall book/ })).toBeVisible();
		await expect
			.element(rendered.getByRole('group', { name: '[COPY: group-position] 1/10', exact: true }))
			.toBeVisible();
		rendered.unmount();
	});
	it.each([
		[1280, 800],
		[1920, 1080],
		[375, 740]
	])(
		'keeps panels and covers consistent at %s by %s with visible inactive neighbors',
		async (width, height) => {
			await browserPage.viewport(width, height);
			authStore.setSession(session('user-1', 'token-1'));
			const books = Array.from({ length: 9 }, (_, i) => ({
				id: 'book-' + i,
				book_id: 'book-' + i,
				title: 'Book ' + i,
				author: 'Author'
			}));
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					json: async () => ({
						books,
						request_id: '42',
						status: 'completed',
						flavor_groups: flavorFixture(
							books.map((book, i) => ({ book_id: book.book_id, rank: i + 1 }))
						)
					})
				})
			);
			const rendered = render(ShortlistPage);
			await expect.element(rendered.getByRole('button', { name: /Book 0 by/ })).toBeVisible();
			const root = document.querySelector('.shortlist-page') as HTMLElement;
			root.style.height = height + 'px';
			await new Promise(requestAnimationFrame);
			const active = () => document.querySelector('.group-slide--active') as HTMLElement;
			const panelHeight = active().querySelector('.group-panel')!.getBoundingClientRect().height;
			const coverWidth = active().querySelector('.book-card')!.getBoundingClientRect().width;
			const track = document.querySelector('.group-track')!.getBoundingClientRect();
			const current = active().getBoundingClientRect();
			expect(current.left).toBeGreaterThan(track.left);
			expect(current.right).toBeLessThan(track.right);
			expect(document.querySelectorAll('.group-slide[inert]')).toHaveLength(11);
			expect(root.querySelector('.shortlist-page__title')).toBeNull();
			expect(root.querySelector('[data-copy-placeholder="grouped-description"]')).toBeNull();
			expect(root.querySelector('.group-controls .shortlist-position')).not.toBeNull();
			expect(root.querySelector('.group-peek')).toBeNull();
			if (width >= 1024) {
				expect(coverWidth).toBeGreaterThan(140);
				expect(current.width).toBeLessThan(track.width * 0.75);
			}
			await rendered.getByRole('button', { name: '[COPY: next-group]', exact: true }).click();

			await expect.element(rendered.getByRole('button', { name: /Book 7 by/ })).toBeVisible();
			await expect
				.poll(() =>
					Math.abs(
						active().querySelector('.group-panel')!.getBoundingClientRect().height - panelHeight
					)
				)
				.toBeLessThan(1);
			await expect
				.poll(() =>
					Math.abs(active().querySelector('.book-card')!.getBoundingClientRect().width - coverWidth)
				)
				.toBeLessThan(1);
			await rendered.getByRole('button', { name: '[COPY: next-group]', exact: true }).click();
			await expect
				.element(
					rendered.getByRole('heading', {
						name: '[COPY: group-label:something_different]',
						exact: true
					})
				)
				.toBeVisible();
			await expect
				.poll(() =>
					Math.abs(
						active().querySelector('.group-panel')!.getBoundingClientRect().height - panelHeight
					)
				)
				.toBeLessThan(1);
			rendered.unmount();
			await browserPage.viewport(1280, 900);
		}
	);
});
