import { withTimeout } from '$lib/requests/timeout';
import { getSupabase } from '$lib/supabase';
import { runAuthMutation } from './mutations';

export const AUTH_SIGNED_IN_EVENT = 'auth:signed-in';

/**
 * After sign-in or sign-up, refresh the session so JWT claims (e.g. is_anonymous) and
 * layout auth state stay in sync, then notify listeners to refresh user-scoped UI.
 */
export async function completeAuthSuccess(): Promise<void> {
	if (typeof window === 'undefined') return;
	const supabase = getSupabase();
	if (!supabase) return;

	try {
		await withTimeout(async (signal) => {
			const { error } = await runAuthMutation(supabase, () => supabase.auth.refreshSession(), {
				signal
			});
			signal.throwIfAborted();
			if (error) {
				console.warn('[auth] refreshSession after sign-in failed:', error.message);
				await supabase.auth.getSession();
			}
		});
	} catch (error) {
		// Authentication already succeeded. A follow-up refresh must not make the
		// modal invite another credential exchange or hide the signed-in event.
		console.warn('[auth] Session refresh after sign-in could not be confirmed:', error);
	}
	window.dispatchEvent(new Event(AUTH_SIGNED_IN_EVENT));
}
