import { getSupabase } from '$lib/supabase';

export const AUTH_SIGNED_IN_EVENT = 'auth:signed-in';

export type AuthSignedInDetail = {
	/** Anonymous user id before account creation (sign-up fallback path). */
	previousAnonymousUserId?: string | null;
};

let authTransitionActive = false;

/** True while anonymous → account sign-up may briefly swap sessions. */
export function isAuthTransitionActive(): boolean {
	return authTransitionActive;
}

/** Call before sign-up when replacing an anonymous session. */
export function beginAuthTransition(): void {
	authTransitionActive = true;
}

/** Clear transition guard after a failed sign-up attempt. */
export function clearAuthTransition(): void {
	authTransitionActive = false;
}

/**
 * After sign-in or sign-up, refresh the session so JWT claims (e.g. is_anonymous) and
 * layout auth state stay in sync, then notify listeners to refresh user-scoped UI.
 */
export async function completeAuthSuccess(detail: AuthSignedInDetail = {}): Promise<void> {
	if (typeof window === 'undefined') return;
	const supabase = getSupabase();
	if (!supabase) {
		authTransitionActive = false;
		return;
	}

	const { error } = await supabase.auth.refreshSession();
	if (error) {
		console.warn('[auth] refreshSession after sign-in failed:', error.message);
		await supabase.auth.getSession();
	}

	authTransitionActive = false;
	window.dispatchEvent(new CustomEvent<AuthSignedInDetail>(AUTH_SIGNED_IN_EVENT, { detail }));
}
