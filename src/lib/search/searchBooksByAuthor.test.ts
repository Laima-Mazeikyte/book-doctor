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

import { BOOK_SEARCH_FUNCTION } from './bookSearchEdge';
import { searchBooksByAuthor } from './searchBooksByAuthor';

function makeSupabase({
	hits,
	rows
}: {
	hits: { book_id: string }[];
	rows: unknown[];
}) {
	const invoke = vi.fn().mockResolvedValue({
		data: { hits, estimatedTotalHits: hits.length },
		error: null
	});
	const inFn = vi.fn().mockResolvedValue({ data: rows, error: null });
	const selectFn = vi.fn().mockReturnValue({ in: inFn });
	const fromFn = vi.fn().mockReturnValue({ select: selectFn });

	return {
		supabase: {
			functions: { invoke },
			from: fromFn
		} as unknown as SupabaseClient,
		invoke,
		fromFn
	};
}

const sampleRow = {
	id: 'uuid-a',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	book_name: 'Alpha',
	author: 'Kitty Thomas',
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
};

describe('searchBooksByAuthor', () => {
	beforeEach(() => {
		getSupabaseMock.mockReset();
	});

	it('returns empty page for blank author without querying', async () => {
		const { supabase, invoke } = makeSupabase({ hits: [], rows: [] });
		getSupabaseMock.mockReturnValue(supabase);

		const out = await searchBooksByAuthor('   ');
		expect(out.books).toEqual([]);
		expect(out.hasMore).toBe(false);
		expect(out.source).toBe('edge');
		expect(invoke).not.toHaveBeenCalled();
	});

	it('invokes edge search with author filter and resolves books', async () => {
		const { supabase, invoke } = makeSupabase({
			hits: [{ book_id: '01KR2ADTNG29NSQV23VAGV8FXB' }],
			rows: [sampleRow]
		});
		getSupabaseMock.mockReturnValue(supabase);

		const out = await searchBooksByAuthor('Kitty Thomas', 0, 50);

		expect(invoke).toHaveBeenCalledWith(BOOK_SEARCH_FUNCTION, {
			body: { author: 'Kitty Thomas', limit: 50, offset: 0 }
		});
		expect(out.books).toHaveLength(1);
		expect(out.books[0].title).toBe('Alpha');
		expect(out.nextOffset).toBe(1);
		expect(out.hasMore).toBe(false);
		expect(out.source).toBe('edge');
	});

	it('author mode does not send q even if the search input contains the author name', async () => {
		const author = 'Ursula K. Le Guin';
		const { supabase, invoke } = makeSupabase({
			hits: [{ book_id: '01KR2ADTNG29NSQV23VAGV8FXB' }],
			rows: [{ ...sampleRow, author }]
		});
		getSupabaseMock.mockReturnValue(supabase);

		await searchBooksByAuthor(author, 0, 50);

		const body = invoke.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(body).toEqual({ author, limit: 50, offset: 0 });
		expect(body).not.toHaveProperty('q');
	});

	it('sets hasMore false on final short page', async () => {
		const { supabase } = makeSupabase({
			hits: [{ book_id: '01KR2ADTR2Q50VTH28JN60PW18' }],
			rows: [{ ...sampleRow, book_id: '01KR2ADTR2Q50VTH28JN60PW18' }]
		});
		getSupabaseMock.mockReturnValue(supabase);

		const out = await searchBooksByAuthor('Jo', 0, 50);
		expect(out.hasMore).toBe(false);
	});

	it('throws when supabase is unavailable', async () => {
		getSupabaseMock.mockReturnValue(null);
		await expect(searchBooksByAuthor('Author')).rejects.toThrow(/unavailable/i);
	});
});
