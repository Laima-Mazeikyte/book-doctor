import { describe, expect, it } from 'vitest';
import { resolveRecommendationsAuthLoad } from './recommendationsAuth';

describe('recommendations auth loading', () => {
	it('returns loading while session restoration is pending', () => {
		const decision = resolveRecommendationsAuthLoad({
			initStatus: 'checking',
			accessToken: 'token-1'
		});

		expect(decision).toEqual({ kind: 'loading' });
	});

	it('returns the access token when restoration settles with a session', () => {
		const decision = resolveRecommendationsAuthLoad({
			initStatus: 'ready',
			accessToken: 'token-1'
		});

		expect(decision).toEqual({ kind: 'fetch', accessToken: 'token-1' });
	});

	it('returns empty for a settled signed-out session', () => {
		const decision = resolveRecommendationsAuthLoad({
			initStatus: 'ready',
			accessToken: null
		});

		expect(decision).toEqual({ kind: 'empty' });
	});

	it('returns error when restoration fails without a token', () => {
		expect(
			resolveRecommendationsAuthLoad({
				initStatus: 'error',
				accessToken: null
			})
		).toEqual({ kind: 'error' });
	});
});
