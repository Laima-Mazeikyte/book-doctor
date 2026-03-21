import { writable, derived } from 'svelte/store';
import type { Session, User } from '@supabase/supabase-js';

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
