import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
	filterBookIdsExcludingUserLists,
	parseRecommendationRank,
	parseRecommendationTimestamp
} from './recommendationFilters';

function exclusionClient(results: Record<string, { data: unknown; error: unknown }>) {
	const from = vi.fn((table: string) => ({ select: async () => results[table] }));
	return { client: { from } as unknown as SupabaseClient, from };
}

describe('filterBookIdsExcludingUserLists', () => {
	it('excludes rated and dismissed books while preserving candidate order', async () => {
		const { client, from } = exclusionClient({
			user_not_interested: { data: [{ book_id: 'dismissed' }], error: null },
			user_ratings: { data: [{ book_id: 'rated' }], error: null }
		});
		await expect(
			filterBookIdsExcludingUserLists(client, ['second', 'rated', 'dismissed', 'first'], {
				excludeNotInterested: true,
				excludeRated: true
			})
		).resolves.toEqual(['second', 'first']);
		expect(from.mock.calls).toEqual([['user_not_interested'], ['user_ratings']]);
	});

	it.each(['user_not_interested', 'user_ratings'])(
		'propagates a failed %s read even if it returns partial data',
		async (table) => {
			const failure = { code: '42501', message: 'Permission denied' };
			const { client } = exclusionClient({
				user_not_interested: { data: [], error: null },
				user_ratings: { data: [], error: null },
				[table]: { data: [{ book_id: 'rated' }], error: failure }
			});
			await expect(
				filterBookIdsExcludingUserLists(client, ['rated', 'dismissed'], {
					excludeNotInterested: true,
					excludeRated: true
				})
			).rejects.toBe(failure);
		}
	);

	it('does not query disabled lists or an empty candidate list', async () => {
		const { client, from } = exclusionClient({});
		await expect(filterBookIdsExcludingUserLists(client, ['book'], {})).resolves.toEqual(['book']);
		await expect(
			filterBookIdsExcludingUserLists(client, [], {
				excludeNotInterested: true,
				excludeRated: true
			})
		).resolves.toEqual([]);
		expect(from).not.toHaveBeenCalled();
	});

	it('does not load ratings when dismissals already exclude every candidate', async () => {
		const { client, from } = exclusionClient({
			user_not_interested: { data: [{ book_id: 'book' }], error: null }
		});
		await expect(
			filterBookIdsExcludingUserLists(client, ['book'], {
				excludeNotInterested: true,
				excludeRated: true
			})
		).resolves.toEqual([]);
		expect(from).toHaveBeenCalledTimes(1);
	});
});

describe('parseRecommendationTimestamp', () => {
	it('returns null for missing or invalid values', () => {
		expect(parseRecommendationTimestamp(null)).toBeNull();
		expect(parseRecommendationTimestamp(undefined)).toBeNull();
		expect(parseRecommendationTimestamp('not-a-date')).toBeNull();
	});

	it('returns epoch ms for valid ISO timestamps', () => {
		const ts = parseRecommendationTimestamp('2026-01-15T12:00:00.000Z');
		expect(ts).toBe(Date.parse('2026-01-15T12:00:00.000Z'));
	});
});

describe('parseRecommendationRank', () => {
	it('accepts positive numbers and numeric strings', () => {
		expect(parseRecommendationRank(3)).toBe(3);
		expect(parseRecommendationRank('4')).toBe(4);
	});

	it('rejects zero, negative, and invalid values', () => {
		expect(parseRecommendationRank(0)).toBeNull();
		expect(parseRecommendationRank(-1)).toBeNull();
		expect(parseRecommendationRank('')).toBeNull();
		expect(parseRecommendationRank('abc')).toBeNull();
	});
});
