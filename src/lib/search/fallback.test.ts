import { afterEach, describe, expect, it, vi } from 'vitest';

import { searchBooksViaApi } from './fallback';

describe('searchBooksViaApi', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('maps API JSON into SearchResultPage with api source', async () => {
		const book = {
			id: '9',
			book_id: 9,
			title: 'Test',
			author: 'Tester'
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				books: [book],
				nextOffset: 24,
				hasMore: true
			})
		} as Response);

		const page = await searchBooksViaApi('needle', 0);

		expect(page.source).toBe('api');
		expect(page.loadedFields).toEqual([]);
		expect(page.books).toEqual([book]);
		expect(page.nextOffset).toBe(24);
		expect(page.hasMore).toBe(true);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it('throws when response is not ok', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 503
		} as Response);

		await expect(searchBooksViaApi('x', 0)).rejects.toThrow('503');
	});
});
