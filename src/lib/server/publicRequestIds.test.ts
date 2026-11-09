import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { GET as getRun } from '../../routes/api/recommendations/+server';
import { GET as getHistory } from '../../routes/api/recommendations/history/+server';
import { GET as getUnique } from '../../routes/api/recommendations/unique/+server';
import { buildFeedPayloadForRequest } from './feedPayload';
import { isPublicRequestId, requestIdColumn } from '$lib/requests/publicId';

const fixture = vi.hoisted(() => ({ createWithAuth: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ createSupabaseWithAuth: fixture.createWithAuth }));
vi.mock('$lib/server/catalogBooks', () => ({
	fetchBooksByUlids: async () => [{ id: 'book', book_id: 'book', title: 'Book', author: 'Author' }],
	fetchBooksByUlidsInOrder: async () => [
		{ id: 'book', book_id: 'book', title: 'Book', author: 'Author' }
	]
}));
let reads: URL[];
let ownerVisible: boolean;
let aliasFailure: boolean;

function client() {
	return createClient('https://public-id.test', 'public-key', {
		db: { retry: false },
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: {
			fetch: async (input) => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				reads.push(url);
				const table = url.pathname.split('/').at(-1);
				if (table === 'recommendation_requests' || table === 'feed_requests') {
					if (aliasFailure) return Response.json({ message: 'Unavailable' }, { status: 503 });
					const public_id = table === 'feed_requests' ? 'FeedRunA' : 'K7mQ2xBa';
					const matches =
						ownerVisible &&
						(!url.searchParams.has('public_id') ||
							url.searchParams.get('public_id') === `eq.${public_id}`);
					return Response.json(
						matches
							? [
									{
										id: 42,
										public_id,
										filters: null,
										status: 'completed',
										result_count: 1,
										error_message: null
									}
								]
							: []
					);
				}
				if (table === 'recommendation_log')
					return Response.json([{ request_id: '42', created_at: '2026-11-05T00:00:00Z' }]);
				if (table === 'recommendation_items')
					return Response.json([
						{ request_id: '42', book_id: 'book', rank: 1, dimension_matches: [] }
					]);
				if (table === 'get_eligible_feed_books_annotated') return Response.json([]);
				if (table === 'user_ratings' || table === 'user_not_interested') return Response.json([]);
				throw new Error(`Unexpected read: ${url}`);
			}
		}
	});
}

function event(path: string) {
	const url = new URL(path, 'http://localhost');
	return {
		url,
		request: new Request(url, { headers: { Authorization: 'Bearer test-token' } })
	} as never;
}

beforeEach(() => {
	reads = [];
	ownerVisible = true;
	aliasFailure = false;
	fixture.createWithAuth.mockReturnValue(client());
});

afterEach(() => vi.restoreAllMocks());

it('distinguishes case-sensitive public IDs from every legacy numeric ID', () => {
	expect(isPublicRequestId('K7mQ2xBa')).toBe(true);
	expect(isPublicRequestId('k7mQ2xBa')).toBe(true);
	expect(isPublicRequestId('12345678')).toBe(false);
	expect(isPublicRequestId('bad-id!!')).toBe(false);
	expect(requestIdColumn('K7mQ2xBa')).toBe('public_id');
	expect(requestIdColumn('560')).toBe('id');
});

it.each(['K7mQ2xBa', '42'])(
	'loads %s using the internal result key and returns only public request references',
	async (id) => {
		const payload = await (
			await getRun(event(`/api/recommendations?request_id=${id}&include_rated=1`))
		).json();
		expect(payload.request_id).toBe('K7mQ2xBa');
		expect(payload.dimensionMatchSnapshotsByBookId.book.request_id).toBe('K7mQ2xBa');
		expect(
			reads
				.find((url) => url.pathname.endsWith('/recommendation_items'))
				?.searchParams.get('request_id')
		).toBe('eq.42');
	}
);

it('returns public IDs in recommendation history and combined dimension evidence', async () => {
	const history = await (await getHistory(event('/api/recommendations/history'))).json();
	expect(history.runs[0].request_id).toBe('K7mQ2xBa');
	expect(reads.filter((url) => url.pathname.endsWith('/recommendation_requests'))).toHaveLength(1);
	const unique = await (await getUnique(event('/api/recommendations/unique'))).json();
	expect(unique.dimensionMatchSnapshotsByBookId.book.request_id).toBe('K7mQ2xBa');
	const metadataReads = reads.filter((url) => url.pathname.endsWith('/recommendation_requests'));
	expect(metadataReads).toHaveLength(2);
	expect(
		metadataReads.every((url) => url.searchParams.get('select')?.includes('status,result_count'))
	).toBe(true);
	expect(
		reads
			.find((url) => url.pathname.endsWith('/recommendation_items'))
			?.searchParams.get('request_id')
	).toBe('in.(42)');
});

it('reuses the latest run metadata while querying its results by the internal ID', async () => {
	const payload = await (await getRun(event('/api/recommendations'))).json();
	expect(payload.request_id).toBe('K7mQ2xBa');
	expect(payload.dimensionMatchSnapshotsByBookId.book.request_id).toBe('K7mQ2xBa');
	expect(reads.filter((url) => url.pathname.endsWith('/recommendation_requests'))).toHaveLength(1);
	expect(
		reads
			.find((url) => url.pathname.endsWith('/recommendation_items'))
			?.searchParams.get('request_id')
	).toBe('eq.42');
});

it.each([
	['history', getHistory, '/api/recommendations/history'],
	['combined', getUnique, '/api/recommendations/unique'],
	['latest', getRun, '/api/recommendations']
] as const)(
	'returns empty %s when no completed request is visible',
	async (_name, handler, path) => {
		ownerVisible = false;
		const payload = await (await handler(event(path))).json();
		if ('runs' in payload) expect(payload.runs).toEqual([]);
		else expect(payload.books).toEqual([]);
		expect(reads.filter((url) => url.pathname.endsWith('/recommendation_requests'))).toHaveLength(
			1
		);
	}
);

it.each([
	['history', getHistory, '/api/recommendations/history'],
	['combined', getUnique, '/api/recommendations/unique'],
	['latest', getRun, '/api/recommendations']
] as const)('fails %s when combined metadata cannot be read', async (_name, handler, path) => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	aliasFailure = true;
	await expect(handler(event(path))).rejects.toMatchObject({ status: 500 });
	expect(reads.some((url) => url.pathname.endsWith('/recommendation_items'))).toBe(false);
});

it.each(['k7mQ2xBa', 'Missing1'])(
	'does not fall through to internal results for unknown public ID %s',
	async (id) => {
		await expect(getRun(event(`/api/recommendations?request_id=${id}`))).rejects.toMatchObject({
			status: 404
		});
		expect(reads.some((url) => url.pathname.endsWith('/recommendation_items'))).toBe(false);
	}
);

it('requires ownership for public-ID resolution', async () => {
	ownerVisible = false;
	await expect(getRun(event('/api/recommendations?request_id=K7mQ2xBa'))).rejects.toMatchObject({
		status: 404
	});
	await expect(buildFeedPayloadForRequest(client(), 'FeedRunA')).rejects.toThrow(
		'Feed request not found'
	);
});

it('reports failed alias reads instead of exposing the internal ID', async () => {
	aliasFailure = true;
	await expect(getRun(event('/api/recommendations?request_id=42'))).rejects.toMatchObject({
		status: 500
	});
});

it.each(['FeedRunA', '42'])(
	'accepts feed reference %s and queries the existing numeric result RPC',
	async (id) => {
		const db = client();
		const rpc = vi.spyOn(db, 'rpc');
		const payload = await buildFeedPayloadForRequest(db, id);
		expect(payload.request_id).toBe('FeedRunA');
		expect(rpc).toHaveBeenCalledWith('get_eligible_feed_books_annotated', {
			p_request_id: '42',
			p_limit: 100
		});
		expect(
			reads
				.find((url) => url.pathname.endsWith('/feed_requests'))
				?.searchParams.get(requestIdColumn(id))
		).toBe(`eq.${id}`);
	}
);
