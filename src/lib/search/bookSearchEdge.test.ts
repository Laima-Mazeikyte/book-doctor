import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
	BOOK_SEARCH_FUNCTION,
	extractBookIdFromHit,
	invokeBookSearch,
	orderedUniqueBookIds,
	type MeilisearchHit
} from './bookSearchEdge';

describe('extractBookIdFromHit', () => {
	it('reads ULID book_id', () => {
		expect(extractBookIdFromHit({ book_id: '01KR2ADTNG29NSQV23VAGV8FXB' })).toBe(
			'01KR2ADTNG29NSQV23VAGV8FXB'
		);
	});

	it('returns null when missing', () => {
		expect(extractBookIdFromHit({ title: 'x' })).toBeNull();
	});
});

describe('orderedUniqueBookIds', () => {
	it('preserves order and drops duplicates', () => {
		const hits: MeilisearchHit[] = [
			{ book_id: '01KR2ADTNG29NSQV23VAGV8FXB' },
			{ book_id: '01KR2ADTNG29NSQV23VAGV8FXB' },
			{ book_id: '01KR2ADTR2Q50VTH28JN60PW18' },
			{ title: 'skip' },
			{ book_id: '01KR2ADTR3AK1D2EYC59RZM9MX' }
		];
		expect(orderedUniqueBookIds(hits)).toEqual([
			'01KR2ADTNG29NSQV23VAGV8FXB',
			'01KR2ADTR2Q50VTH28JN60PW18',
			'01KR2ADTR3AK1D2EYC59RZM9MX'
		]);
	});
});

describe('invokeBookSearch', () => {
	it('parses top-level Meilisearch body', async () => {
		const invoke = vi.fn().mockResolvedValue({
			data: {
				hits: [
					{ book_id: '01KR2ADTNG29NSQV23VAGV8FXB' },
					{ book_id: '01KR2ADTR2Q50VTH28JN60PW18' }
				],
				estimatedTotalHits: 40
			},
			error: null
		});
		const supabase = { functions: { invoke } } as unknown as SupabaseClient;

		const r = await invokeBookSearch(supabase, { q: 'ab', limit: 10, offset: 0 });

		expect(r.bookIds).toEqual([
			'01KR2ADTNG29NSQV23VAGV8FXB',
			'01KR2ADTR2Q50VTH28JN60PW18'
		]);
		expect(r.estimatedTotalHits).toBe(40);
		expect(r.scannedHitCount).toBe(2);
		expect(invoke).toHaveBeenCalledWith(BOOK_SEARCH_FUNCTION, {
			body: { q: 'ab', limit: 10, offset: 0 }
		});
	});

	it('unwraps nested result.hits', async () => {
		const invoke = vi.fn().mockResolvedValue({
			data: {
				result: {
					hits: [{ book_id: '01KR2ADTR3AK1D2EYC59RZM9MX' }],
					estimatedTotalHits: 1
				}
			},
			error: null
		});
		const supabase = { functions: { invoke } } as unknown as SupabaseClient;

		const r = await invokeBookSearch(supabase, { q: 'x', limit: 5, offset: 10 });
		expect(r.bookIds).toEqual(['01KR2ADTR3AK1D2EYC59RZM9MX']);
		expect(r.estimatedTotalHits).toBe(1);
		expect(r.scannedHitCount).toBe(1);
	});

	it('returns null estimatedTotalHits when absent', async () => {
		const invoke = vi.fn().mockResolvedValue({
			data: {
				hits: [
					{ book_id: '01KR2ADTNG29NSQV23VAGV8FXB' },
					{ book_id: '01KR2ADTR2Q50VTH28JN60PW18' }
				]
			},
			error: null
		});
		const supabase = { functions: { invoke } } as unknown as SupabaseClient;

		const r = await invokeBookSearch(supabase, { q: 'x', limit: 24, offset: 0 });
		expect(r.estimatedTotalHits).toBeNull();
		expect(r.scannedHitCount).toBe(2);
	});

	it('throws on invoke error', async () => {
		const invoke = vi.fn().mockResolvedValue({
			data: null,
			error: { message: 'network' }
		});
		const supabase = { functions: { invoke } } as unknown as SupabaseClient;

		await expect(invokeBookSearch(supabase, { q: 'x', limit: 1, offset: 0 })).rejects.toThrow(
			'network'
		);
	});

	it('throws on payload error string', async () => {
		const invoke = vi.fn().mockResolvedValue({
			data: { error: 'bad query' },
			error: null
		});
		const supabase = { functions: { invoke } } as unknown as SupabaseClient;

		await expect(invokeBookSearch(supabase, { q: 'x', limit: 1, offset: 0 })).rejects.toThrow(
			'bad query'
		);
	});
});
