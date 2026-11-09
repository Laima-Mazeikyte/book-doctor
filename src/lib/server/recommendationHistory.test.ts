import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { RequestEvent } from '@sveltejs/kit';
import { GET as getHistory } from '../../routes/api/recommendations/history/+server';
import { GET as getUnique } from '../../routes/api/recommendations/unique/+server';

const fixture = vi.hoisted(() => ({ createWithAuth: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ createSupabaseWithAuth: fixture.createWithAuth }));

type Log = { id: number; request_id: string; created_at: string | null };
let logs: Log[];
let filteredIds: Set<string>;
let selectionTypes: Map<string, string>;
let publicIds: Map<string, string>;
let requestReads: URL[];
let itemWindows: string[][];
let failedLogOffset: number | null;
let failRequests: boolean;
let catalogReads: URL[];
let itemReads: URL[];

function makeLogs(count: number): Log[] {
	return Array.from({ length: count }, (_, index) => ({
		id: count - index,
		request_id: String(count - index),
		created_at: new Date(Date.UTC(2026, 9, 22, 0, count - index)).toISOString()
	}));
}

function inValues(url: URL, column: string): string[] {
	return (url.searchParams.get(column) ?? 'in.()').slice(4, -1).split(',');
}

const fetcher: typeof fetch = async (input) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	const table = url.pathname.split('/').at(-1);
	if (table === 'recommendation_log')
		throw new Error('History must not depend on best-effort logs');
	if (table === 'recommendation_requests') {
		requestReads.push(url);
		const offset = Number(url.searchParams.get('offset') ?? 0);
		if (failRequests || offset === failedLogOffset)
			return Response.json({ message: 'Requests unavailable' }, { status: 503 });
		expect(url.searchParams.get('status')).toBe('eq.completed');
		expect(url.searchParams.get('result_count')).toBe('gt.0');
		const ordered = [...logs].sort((a, b) => {
			if (a.created_at !== b.created_at) {
				if (a.created_at === null) return 1;
				if (b.created_at === null) return -1;
				return b.created_at.localeCompare(a.created_at);
			}
			return b.id - a.id;
		});
		return Response.json(
			ordered.slice(offset, offset + Number(url.searchParams.get('limit'))).map((row) => ({
				...row,
				status: 'completed',
				result_count: 10,
				request_type: selectionTypes.get(row.request_id) ?? null,
				filters: filteredIds.has(row.request_id) ? { genres: { all_of: ['Africa'] } } : null,
				public_id: publicIds.get(row.request_id) ?? null
			}))
		);
	}
	if (table === 'recommendation_items') {
		itemReads.push(url);
		const ids = inValues(url, 'request_id');
		itemWindows.push(ids);
		return Response.json(
			ids.flatMap((request_id) => [
				{ book_id: 'shared', request_id, rank: Number(request_id) <= 5 ? 1 : 2 },
				...Array.from({ length: 9 }, (_, index) => ({
					book_id: `book-${request_id}-${index}`,
					request_id,
					rank: index === 0 ? (Number(request_id) <= 5 ? 2 : 1) : index + 2
				}))
			])
		);
	}
	if (table === 'books') {
		catalogReads.push(url);
		return Response.json(
			inValues(url, 'book_id').map((book_id) => ({
				id: `uuid-${book_id}`,
				book_id,
				book_name: book_id,
				author: 'Author'
			}))
		);
	}
	if (table === 'user_ratings' || table === 'user_not_interested') return Response.json([]);
	throw new Error(`Unexpected table: ${table}`);
};

function event<R extends '/api/recommendations/history' | '/api/recommendations/unique'>(
	path: R
): RequestEvent<Record<string, never>, R> {
	return {
		request: new Request(`http://localhost${path}`, {
			headers: { Authorization: 'Bearer history-test-token' }
		})
	} as RequestEvent<Record<string, never>, R>;
}

describe('50-run recommendation history', () => {
	beforeEach(() => {
		logs = makeLogs(55);
		filteredIds = new Set();
		selectionTypes = new Map();
		publicIds = new Map();
		requestReads = [];
		itemWindows = [];
		itemReads = [];
		catalogReads = [];
		failedLogOffset = null;
		failRequests = false;
		fixture.createWithAuth.mockReturnValue(
			createClient('https://history.test', 'public-test-key', {
				db: { retry: false },
				auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
				global: { fetch: fetcher }
			})
		);
	});

	afterEach(() => vi.restoreAllMocks());

	it('returns the latest 50 completed nonempty requests without consulting worker logs', async () => {
		const payload = await (await getHistory(event('/api/recommendations/history'))).json();
		expect(payload.runs.map((run: Log) => run.request_id)).toEqual(
			logs.slice(0, 50).map((log) => log.request_id)
		);
		expect(requestReads).toHaveLength(1);
		expect(requestReads[0].searchParams.get('limit')).toBe('50');
		expect(fixture.createWithAuth).toHaveBeenCalledWith(
			'history-test-token',
			expect.any(AbortSignal)
		);
	});
	it('includes both selection modes in the existing 50-run For you window', async () => {
		selectionTypes = new Map([
			['55', 'rank_selection'],
			['54', 'recommend_from_selection']
		]);
		publicIds = new Map([
			['55', 'ChooseA1'],
			['54', 'ChooseA2']
		]);
		const history = await (await getHistory(event('/api/recommendations/history'))).json();
		expect(history.runs).toHaveLength(50);
		expect(history.runs.slice(0, 2).map((row: { request_id: string }) => row.request_id)).toEqual([
			'ChooseA1',
			'ChooseA2'
		]);
		await getUnique(event('/api/recommendations/unique'));
		expect(itemWindows[0]).toEqual(logs.slice(0, 50).map((log) => log.request_id));
	});

	it('keeps inspiration provenance from the newest appearance rather than an older run', async () => {
		selectionTypes.set('55', 'recommend_from_selection');
		let payload = await (await getUnique(event('/api/recommendations/unique'))).json();
		expect(payload.selectionSeedBookIds).toContain('shared');
		selectionTypes.delete('55');
		selectionTypes.set('54', 'recommend_from_selection');
		payload = await (await getUnique(event('/api/recommendations/unique'))).json();
		expect(payload.selectionSeedBookIds).not.toContain('shared');
		expect(payload.selectionSeedBookIds).toContain('book-54-0');
	});

	it('fills the same 50-run window for both endpoints when recent runs are filtered', async () => {
		logs = makeLogs(115);
		filteredIds = new Set(logs.slice(0, 60).map((log) => log.request_id));
		publicIds = new Map(
			logs.map((log) => [log.request_id, `Run${log.request_id.padStart(5, '0')}`])
		);
		const expectedIds = logs.slice(60, 110).map((log) => log.request_id);
		const history = await (await getHistory(event('/api/recommendations/history'))).json();
		expect(history.runs.map((run: Log) => run.request_id)).toEqual(
			expectedIds.map((id) => publicIds.get(id))
		);
		expect(requestReads.map((url) => url.searchParams.get('offset'))).toEqual(['0', '50', '100']);
		expect(requestReads).toHaveLength(3);

		const unique = await (await getUnique(event('/api/recommendations/unique'))).json();
		expect(itemWindows).toEqual([expectedIds]);
		expect(unique.recommendationAppearanceCount.shared).toBe(50);
		expect(unique.books).toHaveLength(451);
		expect(unique.dimensionMatchSnapshotsByBookId.shared.request_id).toBe(
			publicIds.get(expectedIds[0])
		);
		expect(requestReads).toHaveLength(6);
	});

	it('calculates book history, recency, appearance counts, and best ranks within the retained window', async () => {
		const payload = await (await getUnique(event('/api/recommendations/unique'))).json();
		expect(itemWindows[0]).toEqual(logs.slice(0, 50).map((log) => log.request_id));
		expect(payload.recommendationAppearanceCount.shared).toBe(50);
		expect(payload.bestRecommendationRank.shared).toBe(2);
		expect(payload.lastRecommendedAt.shared).toBe(Date.parse(logs[0].created_at!));
		expect(payload.recommendationAppearanceCount['book-1-0']).toBeUndefined();
		expect(payload.books.some((book: { book_id: string }) => book.book_id === 'book-1-0')).toBe(
			false
		);
		expect(payload.books).toHaveLength(451);
	});

	it('returns lightweight selection identities and recency without querying synopsis or recommendation evidence', async () => {
		const full = await (await getUnique(event('/api/recommendations/unique'))).json();
		itemReads = [];
		catalogReads = [];
		const input = event('/api/recommendations/unique');
		input.request = new Request('http://localhost/api/recommendations/unique?view=selection', {
			headers: { Authorization: 'Bearer history-test-token' }
		});
		const lean = await (await getUnique(input)).json();
		expect(Object.keys(lean).sort()).toEqual(['books', 'lastRecommendedAt']);
		expect(lean.books.map((book: { book_id: string }) => book.book_id).sort()).toEqual(
			full.books.map((book: { book_id: string }) => book.book_id).sort()
		);
		expect(lean.lastRecommendedAt).toEqual(full.lastRecommendedAt);
		expect(itemReads).toHaveLength(1);
		expect(itemReads[0].searchParams.get('select')).toBe('book_id,request_id,rank');
		expect(
			catalogReads.every(
				(url) => url.searchParams.get('select') === 'id,book_id,slug,book_name,author,year'
			)
		).toBe(true);
		expect(lean.books.every((book: Record<string, unknown>) => !('summary' in book))).toBe(true);
	});

	it('uses a unique tiebreaker for equal timestamps and places undated runs last', async () => {
		logs = [
			{ id: 1, request_id: '1', created_at: null },
			{ id: 2, request_id: '2', created_at: '2026-10-22T00:00:00Z' },
			{ id: 3, request_id: '3', created_at: '2026-10-22T00:00:00Z' }
		];
		const payload = await (await getHistory(event('/api/recommendations/history'))).json();
		expect(payload.runs.map((run: Log) => run.request_id)).toEqual(['3', '2', '1']);
		expect(requestReads[0].searchParams.get('order')).toBe('created_at.desc.nullslast,id.desc');
	});

	it('reports later-page failures instead of returning partial history', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		filteredIds = new Set(logs.slice(0, 10).map((log) => log.request_id));
		failedLogOffset = 50;
		await expect(getHistory(event('/api/recommendations/history'))).rejects.toMatchObject({
			status: 500
		});
		await expect(getUnique(event('/api/recommendations/unique'))).rejects.toMatchObject({
			status: 500
		});
		expect(itemWindows).toHaveLength(0);
	});

	it('reports request-classification failures instead of treating filtered runs as overall runs', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		failRequests = true;
		await expect(getHistory(event('/api/recommendations/history'))).rejects.toMatchObject({
			status: 500
		});
		await expect(getUnique(event('/api/recommendations/unique'))).rejects.toMatchObject({
			status: 500
		});
		expect(itemWindows).toHaveLength(0);
	});

	it('returns successful empty history when there are no runs', async () => {
		logs = [];
		const history = await (await getHistory(event('/api/recommendations/history'))).json();
		const unique = await (await getUnique(event('/api/recommendations/unique'))).json();
		expect(history.runs).toEqual([]);
		expect(unique.hasRuns).toBe(false);
		expect(unique.books).toEqual([]);
		expect(itemWindows).toHaveLength(0);
	});
});
