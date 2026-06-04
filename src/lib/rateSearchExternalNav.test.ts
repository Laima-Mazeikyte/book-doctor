import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	clearRateAuthorSearch,
	consumeRateAuthorSearch,
	markRateAuthorSearch
} from './rateSearchExternalNav';

describe('rate author search nav', () => {
	beforeEach(() => {
		const store = new Map<string, string>();
		vi.stubGlobal('sessionStorage', {
			getItem: vi.fn((key: string) => store.get(key) ?? null),
			removeItem: vi.fn((key: string) => {
				store.delete(key);
			}),
			setItem: vi.fn((key: string, value: string) => {
				store.set(key, value);
			})
		});
	});

	afterEach(() => {
		clearRateAuthorSearch();
		vi.unstubAllGlobals();
	});

	it('consume returns anchor once then null', () => {
		markRateAuthorSearch('Kitty Thomas');
		expect(consumeRateAuthorSearch()).toBe('Kitty Thomas');
		expect(consumeRateAuthorSearch()).toBeNull();
	});

	it('ignores blank author marks', () => {
		markRateAuthorSearch('   ');
		expect(consumeRateAuthorSearch()).toBeNull();
	});
});
