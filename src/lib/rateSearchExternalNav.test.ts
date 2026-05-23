import { afterEach, describe, expect, it } from 'vitest';

import {
	clearRateAuthorSearch,
	consumeRateAuthorSearch,
	markRateAuthorSearch
} from './rateSearchExternalNav';

describe('rate author search nav', () => {
	afterEach(() => {
		clearRateAuthorSearch();
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
