import { get, writable, derived } from 'svelte/store';
import type { Session, User } from '@supabase/supabase-js';

export type AuthInitStatus = 'idle' | 'checking' | 'ready' | 'error';

export interface AuthInitState {
	status: AuthInitStatus;
	error?: string;
}

export interface AuthState {
	session: Session | null;
	user: User | null;
}

function createAuthStore() {
	const { subscribe, set, update } = writable<AuthState>({
		session: null,
		user: null
	});

	return {
		subscribe,
		set,
		update,
		setSession(session: Session | null) {
			set({
				session,
				user: session?.user ?? null
			});
		}
	};
}

export const authStore = createAuthStore();

/** Session restoration only — not anonymous sign-in. Settled by the root layout on mount. */
export const authInitStore = writable<AuthInitState>({ status: 'idle' });

export const authReady = derived(
	authInitStore,
	($init) => $init.status === 'ready' || $init.status === 'error'
);

/** True while layout is restoring an existing Supabase session (not lazy anonymous sign-in). */
export const authRestorePending = derived(
	authInitStore,
	($init) => $init.status === 'idle' || $init.status === 'checking'
);

let authReadyWaiters: Array<() => void> = [];

function notifyAuthReadyWaiters(): void {
	const waiters = authReadyWaiters;
	authReadyWaiters = [];
	for (const resolve of waiters) resolve();
}

function isAuthInitSettled(status: AuthInitStatus): boolean {
	return status === 'ready' || status === 'error';
}

/** Layout: Supabase session restore started (existing session / URL tokens). */
export function markAuthInitChecking(): void {
	authInitStore.set({ status: 'checking' });
}

/** Layout: session restore finished (session may still be null). */
export function markAuthInitReady(): void {
	authInitStore.set({ status: 'ready' });
	notifyAuthReadyWaiters();
}

/** Layout: session restore failed; callers may fall back to unauthenticated flows. */
export function markAuthInitError(message: string): void {
	authInitStore.set({ status: 'error', error: message });
	notifyAuthReadyWaiters();
}

/**
 * Resolves once layout session restoration has settled (`ready` or `error`).
 * Does not wait for lazy anonymous sign-in.
 */
export function waitForAuthReady(): Promise<void> {
	const { status } = get(authInitStore);
	if (isAuthInitSettled(status)) return Promise.resolve();
	return new Promise((resolve) => {
		authReadyWaiters.push(resolve);
	});
}

/**
 * True after Supabase emits PASSWORD_RECOVERY (user opened an email reset link).
 * Cleared after a successful password update or when leaving the reset-password page.
 */
export const passwordRecoveryActive = writable(false);

export function clearPasswordRecoveryFlag(): void {
	passwordRecoveryActive.set(false);
}

/** True when there is no session or the user is anonymous. */
export const isAnonymousOrSignedOut = derived(authStore, ($auth) => {
	if (!$auth.session || !$auth.user) return true;
	return $auth.user.is_anonymous === true;
});

/** Email when signed in with a non-anonymous account; null otherwise. */
export const signedInEmail = derived(authStore, ($auth) => {
	if (!$auth.session || !$auth.user || $auth.user.is_anonymous) return null;
	return $auth.user.email ?? null;
});
