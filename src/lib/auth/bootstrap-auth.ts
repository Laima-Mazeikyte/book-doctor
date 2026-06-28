import { get } from 'svelte/store';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { registerAnonymousSessionStarter } from '$lib/auth/anonymous-session';
import {
	authStore,
	markAuthInitChecking,
	markAuthInitError,
	markAuthInitReady,
	passwordRecoveryActive,
	waitForAuthReady
} from '$lib/stores/auth';
import { ratingsStore } from '$lib/stores/ratings';

export async function getSessionAfterUrlTokens(supabase: SupabaseClient): Promise<Session | null> {
	const hasUrlToken =
		typeof window !== 'undefined' && window.location.hash.includes('access_token');

	if (!hasUrlToken) {
		const {
			data: { session }
		} = await supabase.auth.getSession();
		return session;
	}

	for (let attempt = 0; attempt < 10; attempt++) {
		const {
			data: { session }
		} = await supabase.auth.getSession();
		if (session) return session;
		await new Promise((r) => setTimeout(r, 80));
	}

	return null;
}

export function createLayoutAuthController(supabase: SupabaseClient) {
	let lastAppliedSessionKey: string | null = null;

	function sessionKey(session: Session | null): string {
		return session?.user?.id && session.access_token
			? `${session.user.id}:${session.access_token}`
			: 'none';
	}

	function applyAuthSession(session: Session | null): boolean {
		const key = sessionKey(session);
		if (key === lastAppliedSessionKey) return false;

		lastAppliedSessionKey = key;
		authStore.setSession(session);
		if (session?.user) void ratingsStore.flushPending();
		return true;
	}

	let anonymousSignInPromise: Promise<boolean> | null = null;

	async function ensureAnonymousSession(): Promise<boolean> {
		await waitForAuthReady();
		if (get(authStore).session) return true;
		if (anonymousSignInPromise) return anonymousSignInPromise;

		anonymousSignInPromise = (async () => {
			try {
				const { data: signInData, error } = await supabase.auth.signInAnonymously();

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
				} = await supabase.auth.getSession();
				if (sessionAfterFail) {
					applyAuthSession(sessionAfterFail);
					return true;
				}
				return !!get(authStore).session;
			} catch (e) {
				console.error('[auth] Lazy anonymous sign-in error', e);
				return !!get(authStore).session;
			} finally {
				anonymousSignInPromise = null;
			}
		})();

		return anonymousSignInPromise;
	}

	async function restoreSession(): Promise<void> {
		markAuthInitChecking();
		try {
			const session = await getSessionAfterUrlTokens(supabase);
			if (session) {
				applyAuthSession(session);
			}
			markAuthInitReady();
		} catch (e) {
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
		});

		registerAnonymousSessionStarter(ensureAnonymousSession);
		void restoreSession();

		return () => {
			subscription.unsubscribe();
			registerAnonymousSessionStarter(null);
		};
	}

	return { mount, applyAuthSession };
}

export function mountRatingsRetryListeners(): () => void {
	const retryQueuedRatings = () => {
		void ratingsStore.flushPending();
	};
	const handleVisibilityChange = () => {
		if (document.visibilityState === 'visible') retryQueuedRatings();
	};

	window.addEventListener('online', retryQueuedRatings);
	window.addEventListener('focus', retryQueuedRatings);
	document.addEventListener('visibilitychange', handleVisibilityChange);

	return () => {
		window.removeEventListener('online', retryQueuedRatings);
		window.removeEventListener('focus', retryQueuedRatings);
		document.removeEventListener('visibilitychange', handleVisibilityChange);
	};
}

export function mountRatingsMigratedListener(reloadLibrary: () => void): () => void {
	const handler = () => reloadLibrary();
	window.addEventListener('auth:ratings-migrated', handler);
	return () => window.removeEventListener('auth:ratings-migrated', handler);
}
