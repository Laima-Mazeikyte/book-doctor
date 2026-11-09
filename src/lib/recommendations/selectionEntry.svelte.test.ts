import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Session } from '@supabase/supabase-js';
import { authInitStore, authStore } from '$lib/stores/auth';
import { authModalRequestStore } from '$lib/stores/authModalRequest';
import { librarySaves } from '$lib/stores/librarySaves';
import ChooseBooks from '../../routes/choose-books/+page.svelte';

vi.mock('$lib/components/BookCard.svelte', async () => ({
	default: (await import('./test-support/TestBookCard.svelte')).default
}));

vi.mock('$app/state', () => ({ page: { url: new URL(location.href), state: {} } }));
vi.mock('$app/navigation', () => ({
	beforeNavigate: vi.fn(),
	replaceState: vi.fn(),
	pushState: vi.fn(),
	goto: vi.fn(),
	preloadData: vi.fn()
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path, assets: '', base: '' }));

let unmount: (() => void) | undefined;
beforeEach(() => {
	authStore.setSession(null);
	authInitStore.set({ status: 'checking' });
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ requests: [] })));
});
afterEach(() => {
	unmount?.();
	unmount = undefined;
	authStore.setSession(null);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
function fixture() {
	const view = render(ChooseBooks);
	unmount = () => view.unmount();
	return view;
}

it('does not show signed-out or restore-failed copy before restoration settles', async () => {
	const view = fixture();
	await expect.element(view.getByRole('status')).toHaveTextContent('Restoring your session…');
	await expect
		.element(view.getByRole('button', { name: 'Sign in', exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(view.getByRole('button', { name: 'Reload', exact: true }))
		.not.toBeInTheDocument();
});

it('explains the signed-out state and opens the existing sign-in modal', async () => {
	authInitStore.set({ status: 'ready' });
	const open = vi.spyOn(authModalRequestStore, 'open');
	const view = fixture();
	await expect
		.element(view.getByRole('heading', { name: 'Sign in to choose books', exact: true }))
		.toBeVisible();
	await expect
		.element(view.getByText('Rank your list or find recommendations based on books you select.'))
		.toBeVisible();
	await view.getByRole('button', { name: 'Sign in', exact: true }).click();
	expect(open).toHaveBeenCalledWith('signin');
});

it('distinguishes session restoration failure from being signed out', async () => {
	authInitStore.set({ status: 'error', error: 'Diagnostic failure' });
	const view = fixture();
	await expect
		.element(view.getByRole('heading', { name: 'We couldn’t restore your session.', exact: true }))
		.toBeVisible();
	await expect.element(view.getByText('Reload the page to try again.')).toBeVisible();
	await expect.element(view.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
	await expect
		.element(view.getByRole('button', { name: 'Sign in', exact: true }))
		.not.toBeInTheDocument();
});

it('renders an existing anonymous session without requiring registered sign-in or hydrated library IDs', async () => {
	librarySaves.activateOwner('anonymous-reader');
	authStore.setSession({
		user: { id: 'anonymous-reader', is_anonymous: true },
		access_token: 'token'
	} as Session);
	authInitStore.set({ status: 'ready' });
	const view = fixture();
	await expect.element(view.getByRole('searchbox')).toBeVisible();
	await expect
		.element(view.getByRole('heading', { name: 'Sign in to choose books', exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(view.getByText('Loading your library before getting recommendations…'))
		.toBeVisible();
});
