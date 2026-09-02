import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
	normalizeLikedBookPrecedentIds,
	resolveLikedBookPrecedents
} from './recommendationPrecedents';

describe('normalizeLikedBookPrecedentIds', () => {
	it('treats null as empty and keeps valid IDs unique and ordered', () => {
		expect(normalizeLikedBookPrecedentIds(null)).toEqual([]);
		expect(normalizeLikedBookPrecedentIds([' p2 ', 'p1', 'p2', null, 4, ''])).toEqual(['p2', 'p1']);
	});
});

describe('resolveLikedBookPrecedents', () => {
	it('deduplicates one batch lookup and preserves each list order', async () => {
		const rows = [
			{
				book_id: 'recommended-1',
				rank: 1,
				liked_book_precedent_ids: ['precedent-2', 'precedent-1']
			},
			{ book_id: 'recommended-2', rank: 2, liked_book_precedent_ids: null },
			{
				book_id: 'recommended-3',
				rank: 3,
				liked_book_precedent_ids: ['precedent-1', 'precedent-3']
			},
			{ book_id: 'recommended-11', rank: 11, liked_book_precedent_ids: ['ignored'] }
		];
		const inFn = vi.fn().mockResolvedValue({
			data: [
				{
					id: 'uuid-1',
					book_id: 'precedent-1',
					book_name: 'Precedent one',
					author: 'Author one',
					summary: null,
					year: null,
					genre1: null,
					genre2: null,
					genre3: null,
					genre4: null,
					genre5: null,
					genre6: null,
					genre7: null
				},
				{
					id: 'uuid-2',
					book_id: 'precedent-2',
					book_name: 'Precedent two',
					author: 'Author two',
					summary: null,
					year: null,
					genre1: null,
					genre2: null,
					genre3: null,
					genre4: null,
					genre5: null,
					genre6: null,
					genre7: null
				},
				{
					id: 'uuid-3',
					book_id: 'precedent-3',
					book_name: 'Precedent three',
					author: 'Author three',
					summary: null,
					year: null,
					genre1: null,
					genre2: null,
					genre3: null,
					genre4: null,
					genre5: null,
					genre6: null,
					genre7: null
				}
			],
			error: null
		});
		const selectFn = vi.fn().mockReturnValue({ in: inFn });
		const fromFn = vi.fn().mockReturnValue({ select: selectFn });
		const supabase = { from: fromFn } as unknown as SupabaseClient;

		const precedents = await resolveLikedBookPrecedents(supabase, rows);

		expect(fromFn).toHaveBeenCalledOnce();
		expect(inFn).toHaveBeenCalledWith('book_id', ['precedent-2', 'precedent-1', 'precedent-3']);
		expect(precedents['recommended-1'].map((book) => book.title)).toEqual([
			'Precedent two',
			'Precedent one'
		]);
		expect(precedents['recommended-2']).toEqual([]);
		expect(precedents['recommended-3'].map((book) => book.title)).toEqual([
			'Precedent one',
			'Precedent three'
		]);
		expect(precedents['recommended-11']).toBeUndefined();
	});
});
