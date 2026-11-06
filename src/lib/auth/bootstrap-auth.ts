import { withTimeout } from '$lib/requests/timeout';
import { hasPendingAuthMutation, runAuthMutation } from './mutations';
import { get } from 'svelte/store';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { registerAnonymousSessionStarter } from '$lib/auth/anonymous-session';
import {
	authStore,
	authInitStore,
	markAuthInitChecking,
	markAuthInitError,
	markAuthInitReady,
	passwordRecoveryActive,
	waitForAuthReady
} from '$lib/stores/auth';
import { librarySaves } from '$lib/stores/librarySaves';

export async function getSessionAfterUrlTokens(
	supabase: SupabaseClient,
	signal?: AbortSignal
): Promise<Session | null> {
	return withTimeout(
		async (signal) => {
			const hasUrlToken =
				typeof window !== 'undefined' && window.location.hash.includes('access_token');

			if (!hasUrlToken) {
				const {
					data: { session }
				} = await supabase.auth.getSession();
				return session;
			}

			for (let attempt = 0; attempt < 10; attempt++) {
				signal.throwIfAborted();
				const {
					data: { session }
				} = await supabase.auth.getSession();
				if (session) return session;
				await new Promise((r) => setTimeout(r, 80));
			}

			return null;
		},
		{ signal }
	);
}

export function createLayoutAuthController(supabase: SupabaseClient) {
	let disposed = false;
	let sessionRevision = 0;
	const lifecycle = new AbortController();
	let lastAppliedSessionKey: string | null = null;
	let guestDraftToClaim: string | null = null;

	function sessionKey(session: Session | null): string {
		return session?.user?.id && session.access_token
			? `${session.user.id}:${session.access_token}`
			: 'none';
	}

	function applyAuthSession(session: Session | null): boolean {
		if (disposed) return false;
		sessionRevision++;
		const key = sessionKey(session);
		if (key === lastAppliedSessionKey) return false;

		lastAppliedSessionKey = key;
		if (session?.user.is_anonymous && guestDraftToClaim) {
			librarySaves.claimGuest(session.user.id, guestDraftToClaim);
			guestDraftToClaim = null;
		}
		librarySaves.activateOwner(session?.user.id ?? null);
		authStore.setSession(session);
		return true;
	}

	let anonymousSignInPromise: Promise<boolean> | null = null;

	async function ensureAnonymousSession(): Promise<boolean> {
		await withTimeout(() => waitForAuthReady(), { signal: lifecycle.signal });
		if (get(authStore).session) return true;
		if (disposed || get(authInitStore).status !== 'ready') return false;
		if (anonymousSignInPromise) return anonymousSignInPromise;
		if (hasPendingAuthMutation(supabase)) return false;

		anonymousSignInPromise = (async () => {
			guestDraftToClaim = librarySaves.getOwner();
			try {
				const { data: signInData, error } = await runAuthMutation(
					supabase,
					() => supabase.auth.signInAnonymously(),
					{ signal: lifecycle.signal }
				);

				if (disposed) return false;
				if (!error && signInData?.session) {
					applyAuthSession(signInData.session);
					if (signInData.user) {
						console.debug('[auth] Anonymous sign-in OK, user id:', signInData.user.id);
					}
					return true;
				}

				if (error) {
					console.error('[auth] Anonymous sign-in failed:', error.message, error);
				}

				const {
					data: { session: sessionAfterFail }
				} = await withTimeout(() => supabase.auth.getSession(), { signal: lifecycle.signal });
				if (sessionAfterFail) {
					applyAuthSession(sessionAfterFail);
					return true;
				}
				return !!get(authStore).session;
			} catch (e) {
				console.error('[auth] Lazy anonymous sign-in error', e);
				return !!get(authStore).session;
			} finally {
				if (!hasPendingAuthMutation(supabase)) guestDraftToClaim = null;
				if (!disposed && !get(authStore).session) librarySaves.failGuest();
				anonymousSignInPromise = null;
			}
		})();

		return anonymousSignInPromise;
	}

	async function restoreSession(): Promise<void> {
		markAuthInitChecking();
		const revision = sessionRevision;
		try {
			const session = await getSessionAfterUrlTokens(supabase, lifecycle.signal);
			if (disposed || revision !== sessionRevision) return;
			if (session) {
				applyAuthSession(session);
			}
			markAuthInitReady();
		} catch (e) {
			if (disposed || revision !== sessionRevision) return;
			const message = e instanceof Error ? e.message : 'Session restore failed';
			console.error('[auth] Session restore failed:', e);
			markAuthInitError(message);
		}
	}

	function mount(): () => void {
		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((event, session) => {
			if (event === 'PASSWORD_RECOVERY') {
				passwordRecoveryActive.set(true);
			}
			applyAuthSession(session);
			if (!disposed) markAuthInitReady();
		});

		registerAnonymousSessionStarter(ensureAnonymousSession);
		void restoreSession();

		return () => {
			disposed = true;
			lifecycle.abort();
			subscription.unsubscribe();
			registerAnonymousSessionStarter(null);
		};
	}

	return { mount, applyAuthSession };
}
