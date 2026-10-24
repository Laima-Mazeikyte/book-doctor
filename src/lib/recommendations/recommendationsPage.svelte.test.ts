import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Session } from '@supabase/supabase-js';
import RecommendationsPage from '../../routes/rate/recommendations/+page.svelte';
import { authInitStore, authStore, markAuthInitReady } from '$lib/stores/auth';
import { recommendationsPageStore } from '$lib/stores/recommendationsPage';

const pageState = vi.hoisted(() => ({
	url: new URL('http://localhost/rate/recommendations')
}));

vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/components/BookCard.svelte', async () => ({
	default: (await import('./test-support/TestBookCard.svelte')).default
}));
vi.mock('$lib/components/Button.svelte', async () => ({
	default: (await import('./test-support/TestButton.svelte')).default
}));

function session(userId: string, accessToken: string): Session {
	return { access_token: accessToken, user: { id: userId } } as Session;
}

function uniqueResponse(title?: string) {
	return {
		ok: true,
		status: 200,
		json: async () => ({
			books: title
				? [{ id: `${title}-id`, book_id: `${title}-book`, title, author: 'Author' }]
				: [],
			hasRuns: Boolean(title)
		})
	};
}

describe('recommendations page auth loading', () => {
	beforeEach(() => {
		pageState.url = new URL('http://localhost/rate/recommendations');
		authStore.setSession(null);
		authInitStore.set({ status: 'idle' });
		recommendationsPageStore.ensureUser(null);
		recommendationsPageStore.reset();
	});

	afterEach(() => vi.unstubAllGlobals());

	it('waits for restoration, then makes one authorized request', async () => {
		const fetchMock = vi.fn().mockResolvedValue(uniqueResponse());
		vi.stubGlobal('fetch', fetchMock);
		authInitStore.set({ status: 'checking' });

		const rendered = render(RecommendationsPage);
		await expect.poll(() => fetchMock.mock.calls.length).toBe(0);

		authStore.setSession(session('user-1', 'token-1'));
		markAuthInitReady();
		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		expect(fetchMock).toHaveBeenCalledWith('/api/recommendations/unique', {
			headers: { Authorization: 'Bearer token-1' }
		});

		rendered.unmount();
	});

	it('does not refetch when only the token changes', async () => {
		const fetchMock = vi.fn().mockResolvedValue(uniqueResponse());
		vi.stubGlobal('fetch', fetchMock);
		authStore.setSession(session('user-1', 'token-1'));
		markAuthInitReady();

		const rendered = render(RecommendationsPage);
		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);

		authStore.setSession(session('user-1', 'token-2'));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(fetchMock).toHaveBeenCalledTimes(1);

		rendered.unmount();
	});

	it('does not request when restoration settles without a session', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		authInitStore.set({ status: 'checking' });

		const rendered = render(RecommendationsPage);
		markAuthInitReady();
		await expect.poll(() => document.querySelector('.recommendations-empty')).not.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();

		rendered.unmount();
	});

	it('shows a retry action when restoration fails without a session', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		authInitStore.set({ status: 'error', error: 'network' });

		const rendered = render(RecommendationsPage);
		await expect.element(rendered.getByRole('button', { name: 'Retry' })).toBeVisible();
		expect(fetchMock).not.toHaveBeenCalled();

		rendered.unmount();
	});

	it.each([true, false])(
		'ignores a previous account response (successful: %s)',
		async (success) => {
			let resolveFirst: (response: ReturnType<typeof uniqueResponse>) => void = () => undefined;
			const firstResponse = new Promise<ReturnType<typeof uniqueResponse>>((resolve) => {
				resolveFirst = resolve;
			});
			const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
				const headers = init.headers as Record<string, string>;
				return headers.Authorization === 'Bearer token-1'
					? firstResponse
					: Promise.resolve(uniqueResponse('second-account'));
			});
			vi.stubGlobal('fetch', fetchMock);
			authStore.setSession(session('user-1', 'token-1'));
			markAuthInitReady();

			const rendered = render(RecommendationsPage);
			await expect.poll(() => fetchMock.mock.calls.length).toBe(1);

			authStore.setSession(session('user-2', 'token-2'));
			await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
			await expect
				.poll(() => recommendationsPageStore.getSnapshot().unique.books[0]?.title)
				.toBe('second-account');
			await expect
				.element(rendered.getByTestId('test-book-card'))
				.toHaveTextContent('second-account');

			resolveFirst({
				...uniqueResponse('first-account'),
				ok: success,
				status: success ? 200 : 500
			});
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(recommendationsPageStore.getSnapshot().unique.books[0]?.title).toBe('second-account');
			expect(document.body.textContent).not.toContain('first-account');
			await expect.element(rendered.getByRole('alert')).not.toBeInTheDocument();

			rendered.unmount();
		}
	);

	it('offers a retry action after a failed authorized request', async () => {
		let attempts = 0;
		const fetchMock = vi.fn().mockImplementation(() => {
			attempts += 1;
			return attempts === 1
				? Promise.reject(new Error('network'))
				: Promise.resolve(uniqueResponse('retried'));
		});
		vi.stubGlobal('fetch', fetchMock);
		authStore.setSession(session('user-1', 'token-1'));
		markAuthInitReady();

		const rendered = render(RecommendationsPage);
		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		await expect.element(rendered.getByRole('button', { name: 'Retry' })).toBeVisible();
		await expect.element(rendered.getByText('Couldn’t load your recommendations.')).toBeVisible();

		await rendered.getByRole('button', { name: 'Retry' }).click();
		await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
		await expect
			.poll(() => recommendationsPageStore.getSnapshot().unique.books[0]?.title)
			.toBe('retried');

		rendered.unmount();
	});

	it('keeps cached recommendations visible after an HTTP error and throughout retry', async () => {
		authStore.setSession(session('user-1', 'token-1'));
		markAuthInitReady();
		recommendationsPageStore.ensureUser('user-1');
		recommendationsPageStore.setUnique({
			...recommendationsPageStore.getSnapshot().unique,
			hasRuns: true,
			books: [{ id: 'cached-id', book_id: 'cached-book', title: 'Cached book', author: 'Author' }]
		});
		let resolveRetry!: (response: ReturnType<typeof uniqueResponse>) => void;
		const retryResponse = new Promise<ReturnType<typeof uniqueResponse>>((resolve) => {
			resolveRetry = resolve;
		});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 500 })
			.mockReturnValueOnce(retryResponse);
		vi.stubGlobal('fetch', fetchMock);

		const rendered = render(RecommendationsPage);
		await expect
			.element(rendered.getByRole('alert'))
			.toHaveTextContent('Couldn’t load your recommendations.');
		await expect.element(rendered.getByTestId('test-book-card')).toHaveTextContent('Cached book');
		expect(recommendationsPageStore.getSnapshot().unique.books[0]?.title).toBe('Cached book');

		authStore.setSession(session('user-1', 'refreshed-token'));
		await rendered.getByRole('button', { name: 'Retry', exact: true }).click();
		await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
		expect(fetchMock).toHaveBeenLastCalledWith('/api/recommendations/unique', {
			headers: { Authorization: 'Bearer refreshed-token' }
		});
		await expect.element(rendered.getByTestId('test-book-card')).toHaveTextContent('Cached book');

		resolveRetry(uniqueResponse('Fresh book'));
		await expect.element(rendered.getByTestId('test-book-card')).toHaveTextContent('Fresh book');
		await expect.element(rendered.getByRole('alert')).not.toBeInTheDocument();
		rendered.unmount();
	});

	it('offers retry when refreshing a previously successful empty snapshot fails', async () => {
		authStore.setSession(session('user-1', 'token-1'));
		markAuthInitReady();
		recommendationsPageStore.ensureUser('user-1');
		recommendationsPageStore.setUnique(recommendationsPageStore.getSnapshot().unique);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

		const rendered = render(RecommendationsPage);
		await expect.element(rendered.getByText('Couldn’t load your recommendations.')).toBeVisible();
		await expect.element(rendered.getByRole('button', { name: 'Retry' })).toBeVisible();
		expect(recommendationsPageStore.getSnapshot().uniqueLoaded).toBe(true);
		rendered.unmount();
	});
});
