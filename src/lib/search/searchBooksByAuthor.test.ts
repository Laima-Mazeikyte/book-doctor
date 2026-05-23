import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSupabaseMock } = vi.hoisted(() => ({
	getSupabaseMock: vi.fn()
}));

vi.mock('$app/environment', () => ({
	browser: true
}));

vi.mock('$lib/supabase', () => ({
	getSupabase: getSupabaseMock
}));

import { searchBooksByAuthor } from './searchBooksByAuthor';

function makeSupabase(rows: unknown[], count: number | null) {
	const rangeFn = vi.fn().mockResolvedValue({ data: rows, error: null, count });
	const orderFn = vi.fn().mockReturnValue({ range: rangeFn });
	const ilikeFn = vi.fn().mockReturnValue({ order: orderFn });
	const selectFn = vi.fn().mockReturnValue({ ilike: ilikeFn });
	const fromFn = vi.fn().mockReturnValue({ select: selectFn });

	return {
		supabase: { from: fromFn } as unknown as SupabaseClient,
		fromFn,
		selectFn,
		ilikeFn,
		orderFn,
		rangeFn
	};
}

describe('searchBooksByAuthor', () => {
	beforeEach(() => {
		getSupabaseMock.mockReset();
	});

	it('returns empty page for blank author without querying', async () => {
		const { supabase, fromFn } = makeSupabase([], 0);
		getSupabaseMock.mockReturnValue(supabase);

		const out = await searchBooksByAuthor('   ');
		expect(out.books).toEqual([]);
		expect(out.hasMore).toBe(false);
		expect(out.source).toBe('db-author');
		expect(fromFn).not.toHaveBeenCalled();
	});

	it('queries with case-insensitive exact ilike match and pagination', async () => {
		const rows = [
			{
				id: 'uuid-a',
				book_id: 1,
				book_name: 'Alpha',
				author: 'Kitty Thomas',
				cover_url: null,
				summary: null,
				year: 2020,
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
		const { supabase, ilikeFn, orderFn, rangeFn } = makeSupabase(rows, 64);
		getSupabaseMock.mockReturnValue(supabase);

		const out = await searchBooksByAuthor('Kitty Thomas', 0, 50);

		expect(ilikeFn).toHaveBeenCalledWith('author', 'Kitty Thomas');
		expect(orderFn).toHaveBeenCalledWith('book_name', { ascending: true });
		expect(rangeFn).toHaveBeenCalledWith(0, 49);
		expect(out.books).toHaveLength(1);
		expect(out.books[0].title).toBe('Alpha');
		expect(out.nextOffset).toBe(1);
		expect(out.hasMore).toBe(true);
		expect(out.source).toBe('db-author');
	});

	it('sets hasMore false on final page', async () => {
		const rows = [
			{
				id: 'uuid-a',
				book_id: 1,
				book_name: 'Alpha',
				author: 'Jo',
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
		const { supabase, rangeFn } = makeSupabase(rows, 1);
		getSupabaseMock.mockReturnValue(supabase);

		const out = await searchBooksByAuthor('Jo', 0, 50);

		expect(rangeFn).toHaveBeenCalledWith(0, 49);
		expect(out.hasMore).toBe(false);
	});

	it('throws when supabase is unavailable', async () => {
		getSupabaseMock.mockReturnValue(null);
		await expect(searchBooksByAuthor('Author')).rejects.toThrow(/unavailable/i);
	});
});
