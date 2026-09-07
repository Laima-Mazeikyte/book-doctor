import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchBooksByUlidsInOrder, fetchBooksByUlids } from './catalogBooks';

function row(bookId: string) {
	return {
		id: `uuid-${bookId}`,
		book_id: bookId,
		book_name: bookId,
		author: 'Author',
		summary: null,
		year: null
	};
}

function createSupabaseMock(options?: { failBatch?: number }) {
	const batches: string[][] = [];
	let active = 0;
	let maxActive = 0;
	let batchNumber = 0;
	const from = vi.fn(() => ({
		select: vi.fn(() => ({
			in: vi.fn(async (_column: string, ids: string[]) => {
				const currentBatch = batchNumber++;
				batches.push(ids);
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, 1));
				active -= 1;
				if (options?.failBatch === currentBatch)
					return { data: null, error: new Error('batch failed') };
				return { data: ids.map(row), error: null };
			})
		}))
	}));
	return {
		supabase: { from } as unknown as SupabaseClient,
		batches,
		get maxActive() {
			return maxActive;
		}
	};
}

describe('catalog batching', () => {
	it('deduplicates queries, caps batches at 100, and keeps ordered output', async () => {
		const mock = createSupabaseMock();
		const ids = Array.from({ length: 249 }, (_, i) => `book-${i}`);
		const books = await fetchBooksByUlidsInOrder(mock.supabase, [...ids, ids[0]]);

		expect(mock.batches).toHaveLength(3);
		expect(mock.batches.map((batch) => batch.length)).toEqual([100, 100, 49]);
		expect(mock.maxActive).toBeLessThanOrEqual(3);
		expect(books.map((book) => book.book_id)).toEqual([...ids, ids[0]]);
	});

	it('rejects when any catalog batch fails', async () => {
		const mock = createSupabaseMock({ failBatch: 1 });
		const ids = Array.from({ length: 201 }, (_, i) => `book-${i}`);

		await expect(fetchBooksByUlids(mock.supabase, ids)).rejects.toThrow('batch failed');
	});
});
