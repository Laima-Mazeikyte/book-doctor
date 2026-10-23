import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Session } from '@supabase/supabase-js';
import ShortlistPage from '../../routes/rate/recommendations/shortlist/+page.svelte';
import { authStore } from '$lib/stores/auth';
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
	});

	afterEach(() => vi.unstubAllGlobals());

	it('restarts with an access token when the session is restored after mounting', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 401 })
			.mockResolvedValue(recommendationsResponse('Restored recommendation'));
		vi.stubGlobal('fetch', fetchMock);

		const rendered = render(ShortlistPage);
		await expect.element(rendered.getByRole('alert')).toHaveTextContent('HTTP 401');
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

	it('clears the previous account cache and ignores its late response after switching accounts', async () => {
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

		resolveFirst(recommendationsResponse('Late first account recommendation'));
		await firstResponse;
		await new Promise(requestAnimationFrame);
		await tick();
		expect(recommendationsPageStore.getRun('42')?.books[0]?.title).toBe(
			'Second account recommendation'
		);
		expect(document.body.textContent).not.toContain('Late first account recommendation');
		rendered.unmount();
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
		await expect.element(rendered.getByRole('alert')).toHaveTextContent('HTTP 401');
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/recommendations?request_id=42', {
			headers: {}
		});

		resolveFirst(recommendationsResponse('Signed out account recommendation'));
		await firstResponse;
		await new Promise(requestAnimationFrame);
		await tick();
		expect(recommendationsPageStore.getRun('42')).toBeUndefined();
		expect(document.body.textContent).not.toContain('Signed out account recommendation');
		await expect.element(rendered.getByRole('alert')).toHaveTextContent('HTTP 401');
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
		await expect.element(rendered.getByRole('alert')).toHaveTextContent('Network unavailable');
		await rendered.getByRole('button', { name: 'Try again', exact: true }).click();
		await expect
			.element(rendered.getByRole('heading', { name: 'Retried recommendation', exact: true }))
			.toBeVisible();
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/recommendations?request_id=42', {
			headers: { Authorization: 'Bearer token-1' }
		});
		expect(recommendationsPageStore.getRun('42')?.books[0]?.title).toBe('Retried recommendation');
		rendered.unmount();
	});
});
