import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getBookmarks } from '../../routes/api/bookmarks/+server';
import { GET as getNotInterested } from '../../routes/api/not-interested/books/+server';
import {
	createLibraryLoadCoordinator,
	loadUserLibraryDetails,
	loadUserLibraryIds
} from '$lib/auth/user-library-loaders';
import { notInterestedStore } from '$lib/stores/notInterested';
import { planToReadStore } from '$lib/stores/planToRead';
import { ratingsStore } from '$lib/stores/ratings';
import { readAllPages, readBookIdBatches } from '$lib/supabase/pagination';

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseWithAuth: () => state.client
}));

const books = Array.from({ length: 1205 }, (_, index) => ({
	id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
	book_id: `01${String(index).padStart(24, '0')}`,
	book_name: `Book ${index}`,
	author: `Author ${index}`,
	summary: null,
	year: null
}));

/** Real Supabase query builders, backed by a synthetic REST API with the live 1,000-row cap. */
function fixture(
	options: { missingJoins?: boolean; failTable?: string; failOffset?: number } = {}
) {
	const requests: URL[] = [];
	const client = createClient('https://library-pagination.test', 'test-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (input) => {
				const url = new URL(String(input));
				requests.push(url);
				const table = url.pathname.split('/').at(-1);
				const offset = Number(url.searchParams.get('offset') ?? 0);
				const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000), 1000);
				if (table === options.failTable && offset === options.failOffset) {
					return Response.json(
						{ code: 'TEST', message: 'Later page failed', details: '', hint: '' },
						{ status: 503 }
					);
				}
				if (table === 'books') {
					const ids = new Set(url.searchParams.get('book_id')?.slice(4, -1).split(',') ?? []);
					return Response.json(books.filter((book) => ids.has(book.book_id)).slice(0, limit));
				}
				return Response.json(
					books.slice(offset, offset + limit).map((book) => ({
						book_id: book.book_id,
						book_rating: 4,
						created_at: '2026-01-01T00:00:00Z',
						...(options.missingJoins ? {} : { books: book })
					}))
				);
			}
		}
	});
	state.client = client;
	return { client, requests };
}

beforeEach(() => {
	ratingsStore.setPersistence(null);
	planToReadStore.setPersistence(null);
	notInterestedStore.setPersistence(null);
	ratingsStore.reset();
	planToReadStore.reset();
	notInterestedStore.reset();
});

describe('large bookshelf collections', () => {
	it.each([
		['bookmarks', 'user_bookmarks'],
		['not interested', 'user_not_interested']
	] as const)('returns all 1,205 %s with complete catalog details', async (_, table) => {
		const { requests } = fixture();
		const event = {
			request: new Request('https://app.test/api/library', {
				headers: { Authorization: 'Bearer test-token' }
			})
		};
		const response =
			table === 'user_bookmarks'
				? await getBookmarks(event as Parameters<typeof getBookmarks>[0])
				: await getNotInterested(event as Parameters<typeof getNotInterested>[0]);
		const result = await response.json();
		expect(result.books.map((book: { id: string }) => book.id)).toEqual(
			books.map((book) => book.id)
		);
		if (table === 'user_bookmarks') expect(result.bookIds).toHaveLength(1205);
		const collectionRequests = requests.filter((url) => url.pathname.endsWith(table));
		expect(collectionRequests.map((url) => url.searchParams.get('offset'))).toEqual([
			'0',
			'500',
			'1000'
		]);
		expect(
			collectionRequests.every((url) => url.searchParams.get('order')?.includes('book_id.asc'))
		).toBe(true);
		const catalogRequests = requests.filter((url) => url.pathname.endsWith('/books'));
		expect(catalogRequests).toHaveLength(7);
		expect(
			catalogRequests.every(
				(url) => (url.searchParams.get('book_id')?.split(',').length ?? 0) <= 200
			)
		).toBe(true);
	});

	it.each([false, true])(
		'hydrates every collection and rated detail (missing joins: %s)',
		async (missingJoins) => {
			const { client } = fixture({ missingJoins });
			const coordinator = createLibraryLoadCoordinator();
			const requestId = coordinator.nextRequest();
			await loadUserLibraryIds(client, 'test-user', requestId, coordinator);
			await loadUserLibraryDetails(client, 'test-user', requestId, coordinator);
			expect(get(ratingsStore).size).toBe(1205);
			expect(get(planToReadStore).size).toBe(1205);
			expect(get(notInterestedStore).size).toBe(1205);
			const rated = get(ratingsStore.ratedBooks);
			expect(rated).toHaveLength(1205);
			expect(rated.at(-1)?.book.title).toBe('Book 1204');
		}
	);

	it('fails the endpoint instead of returning a partial collection when a later page fails', async () => {
		fixture({ failTable: 'user_bookmarks', failOffset: 500 });
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await expect(
				getBookmarks({
					request: new Request('https://app.test/api/bookmarks', {
						headers: { Authorization: 'Bearer test-token' }
					})
				} as Parameters<typeof getBookmarks>[0])
			).rejects.toMatchObject({ status: 500 });
		} finally {
			log.mockRestore();
		}
	});
});

describe('paged reads', () => {
	it('continues past an exactly full last page and handles an empty collection', async () => {
		const rows = books.slice(0, 1000);
		const read = vi.fn(async (from: number, to: number) => ({
			data: rows.slice(from, to + 1),
			error: null
		}));
		expect((await readAllPages(read)).data).toHaveLength(1000);
		expect(read).toHaveBeenCalledTimes(3);
		expect(await readAllPages(async () => ({ data: [], error: null }))).toEqual({
			data: [],
			error: null
		});
	});

	it('discards a response when the active user changes and stops requesting pages', async () => {
		let stale = false;
		const read = vi.fn(async () => {
			stale = true;
			return { data: books.slice(0, 500), error: null };
		});
		expect(await readAllPages(read, () => stale)).toEqual({ data: null, error: null });
		expect(read).toHaveBeenCalledTimes(1);
	});

	it('does not expose successful catalog batches when a later batch fails', async () => {
		const error = {
			code: 'TEST',
			message: 'Batch failed',
			details: '',
			hint: '',
			name: 'PostgrestError'
		};
		const result = await readBookIdBatches(
			books.map((book) => book.book_id),
			async (ids) =>
				ids.includes(books[200].book_id)
					? { data: null, error }
					: { data: books.slice(0, 200), error: null }
		);
		expect(result).toEqual({ data: null, error });
	});
});
