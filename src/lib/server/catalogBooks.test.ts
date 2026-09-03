import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchBooksByUlidsInOrder } from './catalogBooks';

describe('catalog book quality evidence selection', () => {
	it('selects and maps quality fields for ordered catalog books', async () => {
		const rows = [
			{
				id: 'uuid-book',
				book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
				book_name: 'A book',
				author: 'An author',
				summary: null,
				year: null,
				quality_percentile: 96.42,
				quality_band: 'top_5_percent'
			}
		];
		const inFn = vi.fn().mockResolvedValue({ data: rows, error: null });
		const selectFn = vi.fn().mockReturnValue({ in: inFn });
		const fromFn = vi.fn().mockReturnValue({ select: selectFn });
		const supabase = { from: fromFn } as unknown as SupabaseClient;

		const books = await fetchBooksByUlidsInOrder(supabase, [rows[0].book_id]);

		expect(selectFn).toHaveBeenCalledWith(
			expect.stringContaining('quality_percentile, quality_band')
		);
		expect(books[0]).toMatchObject({
			qualityPercentile: 96.42,
			qualityBand: 'top_5_percent'
		});
	});
});
