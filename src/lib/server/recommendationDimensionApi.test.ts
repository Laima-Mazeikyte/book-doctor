import { beforeEach, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { GET as getRun } from '../../routes/api/recommendations/+server';
import { GET as getUnique } from '../../routes/api/recommendations/unique/+server';
import { fetchRecommendations } from '$lib/recommendations/fetchRecommendations';

const fixture = vi.hoisted(() => ({
	selects: [] as string[],
	createWithAuth: vi.fn(),
	rows: [
		{
			book_id: 'series',
			request_id: 'old',
			rank: 1,
			dimension_matches: [{ dimension_key: 'spice', candidate_raw_score: 1 }],
			author_relationship_evidence: ['Older author']
		},
		{
			book_id: 'book',
			request_id: 'new',
			rank: 2,
			dimension_matches: [
				{ dimension_key: 'spice', candidate_raw_score: 0 },
				{ dimension_key: 'pace', candidate_raw_score: 1 }
			],
			author_relationship_evidence: ['Liked author']
		},
		{
			book_id: 'series',
			request_id: 'new',
			rank: 1,
			dimension_matches: [],
			author_relationship_evidence: []
		}
	],
	books: [
		{ id: 'b', book_id: 'book', title: 'Book', author: 'Author' },
		{ id: 's', book_id: 'series', title: 'Series', author: 'Author' }
	],
	filteredBookIds: null as string[] | null
}));

vi.mock('$lib/server/supabase', () => ({ createSupabaseWithAuth: fixture.createWithAuth }));
vi.mock('$lib/server/catalogBooks', () => ({
	fetchBooksByUlids: async (_supabase: unknown, ids: string[]) =>
		fixture.books.filter((book) => ids.includes(book.book_id)).map((book) => ({ ...book })),
	fetchBooksByUlidsInOrder: async (_supabase: unknown, ids: string[]) =>
		ids
			.map((id) => fixture.books.find((book) => book.book_id === id))
			.filter((book): book is (typeof fixture.books)[number] => book != null)
			.map((book) => ({ ...book }))
}));
vi.mock('$lib/server/recommendationFilters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/recommendationFilters')>()),
	filterBookIdsExcludingUserLists: async (_db: unknown, ids: string[]) =>
		fixture.filteredBookIds ?? ids
}));

beforeEach(() => {
	fixture.selects.length = 0;
	fixture.filteredBookIds = null;
	fixture.createWithAuth.mockImplementation(() => ({
		from(table: string) {
			let rows: Array<Record<string, unknown>> =
				table === 'recommendation_log'
					? [
							{ request_id: 'new', created_at: '2026-09-06T00:00:00Z' },
							{ request_id: 'old', created_at: '2026-09-05T00:00:00Z' }
						]
					: [...fixture.rows];
			const query = {
				select(fields: string) {
					fixture.selects.push(fields);
					return query;
				},
				eq(key: string, value: unknown) {
					rows = rows.filter((row) => row[key] === value);
					return query;
				},
				in() {
					return query;
				},
				order(key: string) {
					if (key === 'rank') rows.sort((a, b) => Number(a.rank) - Number(b.rank));
					return query;
				},
				limit(count: number) {
					rows = rows.slice(0, count);
					return query;
				},
				then(resolve: (value: unknown) => unknown) {
					return Promise.resolve({ data: rows, error: null }).then(resolve);
				}
			};
			return query;
		}
	}));
});

function event<R extends '/api/recommendations' | '/api/recommendations/unique'>(
	path: R,
	query = ''
): RequestEvent<Record<string, never>, R> {
	return {
		url: new URL(path + query, 'http://localhost'),
		request: new Request('http://localhost' + path, {
			headers: { Authorization: 'Bearer fixture-token' }
		})
	} as RequestEvent<Record<string, never>, R>;
}

it('carries stored matches through the run API and frontend mapper without changing rank or author evidence', async () => {
	const response = await getRun(event('/api/recommendations', '?request_id=new'));
	const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
	try {
		const payload = await fetchRecommendations('fixture-token', 'new');
		expect(payload.books.map((b) => b.book_id)).toEqual(['series', 'book']);
		expect(payload.dimensionMatchSnapshotsByBookId).toEqual({
			series: { request_id: 'new', matches: [] },
			book: { request_id: 'new', matches: fixture.rows[1].dimension_matches }
		});
		expect(payload.authorRelationshipAuthorsByBookId).toEqual({
			series: [],
			book: ['Liked author']
		});
		expect(fixture.selects.some((s) => s.includes('dimension_matches'))).toBe(true);
		expect(fixture.createWithAuth).toHaveBeenCalledWith('fixture-token');
	} finally {
		fetchMock.mockRestore();
	}
});

it('uses the latest containing request in the combined API even when database items arrive out of order', async () => {
	const payload = await (await getUnique(event('/api/recommendations/unique'))).json();
	expect(payload.books.map((b: { book_id: string }) => b.book_id)).toEqual(['book', 'series']);
	expect(payload.dimensionMatchSnapshotsByBookId.series).toEqual({
		request_id: 'new',
		matches: []
	});
	expect(payload.dimensionMatchSnapshotsByBookId.book).toEqual({
		request_id: 'new',
		matches: fixture.rows[1].dimension_matches
	});
	expect(payload.recommendationAppearanceCount).toEqual({ series: 2, book: 1 });
	expect(payload.bestRecommendationRank).toEqual({ series: 1, book: 2 });
	expect(fixture.selects.some((s) => s.includes('dimension_matches'))).toBe(true);
});

it('resolves evidence only for books that survive filtering', async () => {
	fixture.filteredBookIds = ['book'];

	const response = await getRun(event('/api/recommendations', '?request_id=new'));
	const payload = await response.json();

	expect(payload.books.map((book: { book_id: string }) => book.book_id)).toEqual(['book']);
	expect(payload.dimensionMatchSnapshotsByBookId).toEqual({
		book: { request_id: 'new', matches: fixture.rows[1].dimension_matches }
	});
	expect(payload.authorRelationshipAuthorsByBookId).toEqual({ book: ['Liked author'] });

	const uniquePayload = await (await getUnique(event('/api/recommendations/unique'))).json();
	expect(uniquePayload.books.map((book: { book_id: string }) => book.book_id)).toEqual(['book']);
	expect(uniquePayload.dimensionMatchSnapshotsByBookId).toEqual({
		book: { request_id: 'new', matches: fixture.rows[1].dimension_matches }
	});
	expect(uniquePayload.authorRelationshipAuthorsByBookId).toEqual({ book: ['Liked author'] });
});
