import type { AuthInitStatus } from '$lib/stores/auth';

export type RecommendationsAuthLoad =
	| { kind: 'loading' }
	| { kind: 'fetch'; accessToken: string }
	| { kind: 'empty' }
	| { kind: 'error' };

export function resolveRecommendationsAuthLoad({
	initStatus,
	accessToken
}: {
	initStatus: AuthInitStatus;
	accessToken: string | null;
}): RecommendationsAuthLoad {
	if (initStatus === 'idle' || initStatus === 'checking') return { kind: 'loading' };
	if (accessToken) return { kind: 'fetch', accessToken };
	return initStatus === 'error' ? { kind: 'error' } : { kind: 'empty' };
}
