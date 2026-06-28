import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

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
import { searchBooks } from './client';
import { nextRateSearchModeAfterQueryChange } from './rateSearchAuthorMode';

describe('nextRateSearchModeAfterQueryChange', () => {
	const author = 'Ursula K. Le Guin';

	it('keeps author mode while the query still matches the anchor', () => {
		expect(nextRateSearchModeAfterQueryChange('author', author, author)).toBe('author');
		expect(nextRateSearchModeAfterQueryChange('author', author, `  ${author}  `)).toBe('author');
	});

	it('manual edit after author mode resets to q search', async () => {
		const edited = 'Ursula K. Le';
		expect(nextRateSearchModeAfterQueryChange('author', author, edited)).toBe('fulltext');

		const invoke = vi.fn().mockResolvedValue({
			data: {
				hits: [{ book_id: '01KR2ADTNG29NSQV23VAGV8FXB' }],
				estimatedTotalHits: 1
			},
			error: null
		});
		const inFn = vi.fn().mockResolvedValue({
			data: [
				{
					id: 'uuid-a',
					book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
					book_name: 'Alpha',
					author: edited,
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
			],
			error: null
		});
		const selectFn = vi.fn().mockReturnValue({ in: inFn });
		const fromFn = vi.fn().mockReturnValue({ select: selectFn });
		getSupabaseMock.mockReturnValue({
			functions: { invoke },
			from: fromFn
		} as unknown as SupabaseClient);

		await searchBooks(edited, 0, 50);

		const body = invoke.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(body).toEqual({ q: edited, limit: 50, offset: 0 });
		expect(body).not.toHaveProperty('author');
		expect(invoke).toHaveBeenCalledWith(BOOK_SEARCH_FUNCTION, {
			body: { q: edited, limit: 50, offset: 0 }
		});
	});
});
