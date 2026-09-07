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
		await expect.element(rendered.getByRole('button', { name: 'Try again' })).toBeVisible();
		expect(fetchMock).not.toHaveBeenCalled();

		rendered.unmount();
	});

	it('keeps late results from the previous account out of the page', async () => {
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

		resolveFirst(uniqueResponse('first-account'));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(recommendationsPageStore.getSnapshot().unique.books[0]?.title).toBe('second-account');
		expect(document.body.textContent).not.toContain('first-account');

		rendered.unmount();
	});

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
		await expect.element(rendered.getByRole('button', { name: 'Try again' })).toBeVisible();

		await rendered.getByRole('button', { name: 'Try again' }).click();
		await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
		await expect
			.poll(() => recommendationsPageStore.getSnapshot().unique.books[0]?.title)
			.toBe('retried');

		rendered.unmount();
	});
});
