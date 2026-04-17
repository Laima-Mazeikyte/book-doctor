import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { resolveBooksByNumericIdsInOrder } from './resolveBooksFromSupabase';

describe('resolveBooksByNumericIdsInOrder', () => {
	it('returns books in the same order as bookIds', async () => {
		const rows = [
			{
				id: 'uuid-b',
				book_id: 2,
				book_name: 'B',
				author: 'Auth',
				cover_url: null,
				summary: null,
				year: 2000,
				genre1: null,
				genre2: null,
				genre3: null,
				genre4: null,
				genre5: null,
				genre6: null,
				genre7: null,
				type: null
			},
			{
				id: 'uuid-a',
				book_id: 1,
				book_name: 'A',
				author: 'Auth',
				cover_url: null,
				summary: null,
				year: null,
				genre1: null,
				genre2: null,
				genre3: null,
				genre4: null,
				genre5: null,
				genre6: null,
				genre7: null,
				type: null
			}
		];

		const inFn = vi.fn().mockResolvedValue({ data: rows, error: null });
		const selectFn = vi.fn().mockReturnValue({ in: inFn });
		const fromFn = vi.fn().mockReturnValue({ select: selectFn });

		const supabase = { from: fromFn } as unknown as SupabaseClient;

		const ordered = await resolveBooksByNumericIdsInOrder(supabase, [1, 2, 99]);

		expect(ordered.map((b) => b.book_id)).toEqual([1, 2]);
		expect(ordered[0].title).toBe('A');
		expect(ordered[1].title).toBe('B');
		expect(inFn).toHaveBeenCalledWith('book_id', [1, 2, 99]);
	});

	it('returns empty array for empty input without querying', async () => {
		const fromFn = vi.fn();
		const supabase = { from: fromFn } as unknown as SupabaseClient;

		const out = await resolveBooksByNumericIdsInOrder(supabase, []);
		expect(out).toEqual([]);
		expect(fromFn).not.toHaveBeenCalled();
	});
});
