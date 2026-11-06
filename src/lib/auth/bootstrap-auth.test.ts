import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createLayoutAuthController } from './bootstrap-auth';
import { ensureAnonymousSessionStarted } from './anonymous-session';
import { authInitStore, authStore } from '$lib/stores/auth';
import { REQUEST_TIMEOUT_MS } from '$lib/requests/timeout';

const saves = vi.hoisted(() => ({
	getOwner: () => 'guest:draft',
	claimGuest: vi.fn(),
	activateOwner: vi.fn(),
	failGuest: vi.fn()
}));
vi.mock('$lib/stores/librarySaves', () => ({ librarySaves: saves }));
let stop: (() => void) | undefined;
beforeEach(() => {
	vi.useFakeTimers();
	authStore.setSession(null);
	authInitStore.set({ status: 'idle' });
	vi.clearAllMocks();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	stop?.();
	stop = undefined;
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function fixture() {
	let finish!: (result: { data: { session: Session | null } }) => void;
	const restoration = new Promise<{ data: { session: Session | null } }>((resolve) => {
		finish = resolve;
	});
	let event!: (event: string, session: Session | null) => void;
	const anonymous = vi.fn(() => new Promise(() => {}));
	const client = {
		auth: {
			getSession: vi.fn(() => restoration),
			signInAnonymously: anonymous,
			onAuthStateChange: (callback: typeof event) => {
				event = callback;
				return { data: { subscription: { unsubscribe: vi.fn() } } };
			}
		}
	} as unknown as SupabaseClient;
	stop = createLayoutAuthController(client).mount();
	return {
		finish,
		anonymous,
		event: (name: string, session: Session | null) => event(name, session)
	};
}
const session = (id: string) =>
	({ user: { id, is_anonymous: false }, access_token: id }) as Session;

it('settles restoration timeout without starting a competing anonymous account', async () => {
	const api = fixture();
	await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
	expect(get(authInitStore).status).toBe('error');
	await expect(ensureAnonymousSessionStarted()).resolves.toBe(false);
	expect(api.anonymous).not.toHaveBeenCalled();
	api.finish({ data: { session: session('late') } });
	await vi.advanceTimersByTimeAsync(0);
	expect(get(authStore).session).toBeNull();
	// SDK events remain authoritative even after the waiting UI has timed out.
	api.event('SIGNED_IN', session('late'));
	expect(get(authStore).user?.id).toBe('late');
	expect(get(authInitStore).status).toBe('ready');
});

it('does not let a delayed restoration overwrite a newer account event', async () => {
	const api = fixture();
	api.event('SIGNED_IN', session('new-account'));
	api.finish({ data: { session: session('old-account') } });
	await vi.advanceTimersByTimeAsync(0);
	expect(get(authStore).user?.id).toBe('new-account');
});

it('does not repeat an anonymous sign-in after an uncertain timeout', async () => {
	const api = fixture();
	api.finish({ data: { session: null } });
	await vi.advanceTimersByTimeAsync(0);
	const pending = ensureAnonymousSessionStarted();
	await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
	await expect(pending).resolves.toBe(false);
	await expect(ensureAnonymousSessionStarted()).resolves.toBe(false);
	expect(api.anonymous).toHaveBeenCalledTimes(1);
});

it('allows deliberate anonymous-session recovery after a late definitive SDK failure', async () => {
	const api = fixture();
	let fail!: () => void;
	api.anonymous.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				fail = () => resolve({ data: { session: null }, error: new Error('Rejected by auth') });
			})
	);
	api.finish({ data: { session: null } });
	await vi.advanceTimersByTimeAsync(0);
	const pending = ensureAnonymousSessionStarted();
	await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
	await expect(pending).resolves.toBe(false);
	await expect(ensureAnonymousSessionStarted()).resolves.toBe(false);
	expect(api.anonymous).toHaveBeenCalledOnce();
	fail();
	await vi.advanceTimersByTimeAsync(0);
	const retry = ensureAnonymousSessionStarted();
	await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
	await expect(retry).resolves.toBe(false);
	expect(api.anonymous).toHaveBeenCalledTimes(2);
});

it('ignores restoration and callbacks after destruction', async () => {
	const api = fixture();
	stop?.();
	stop = undefined;
	api.finish({ data: { session: session('late') } });
	api.event('SIGNED_IN', session('late'));
	await vi.advanceTimersByTimeAsync(0);
	expect(get(authStore).session).toBeNull();
	expect(saves.activateOwner).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});
