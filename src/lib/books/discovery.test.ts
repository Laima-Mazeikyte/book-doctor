import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	discoveryReason,
	loadBookDiscovery,
	visibleDiscoveryBooks,
	type DiscoveryBook
} from './discovery';

const id = (n: number) => `01${String(n).padStart(24, '0')}`;
function book(n: number): DiscoveryBook {
	return {
		book_id: id(n),
		slug: `book-${n}`,
		title: `Book ${n}`,
		author: 'Author',
		reason: { code: 'shared_profile', params: {} }
	};
}
const payload = {
	book_id: id(1),
	release_id: 'release',
	similar_experience: [book(3), book(2)],
	different_direction: [book(4)]
};
function client(data: unknown = payload, error: { message: string } | null = null) {
	const abortSignal = vi.fn().mockResolvedValue({ data, error });
	const rpc = vi.fn().mockReturnValue({ abortSignal });
	return { supabase: { rpc } as unknown as SupabaseClient, rpc, abortSignal };
}

it('retrieves both lists and metadata in one public RPC, preserving server order', async () => {
	const api = client();
	const signal = new AbortController().signal;
	expect(await loadBookDiscovery(api.supabase, id(1), signal)).toEqual({
		bookId: id(1),
		releaseId: 'release',
		similarExperience: [book(3), book(2)],
		differentDirection: [book(4)]
	});
	expect(api.rpc).toHaveBeenCalledExactlyOnceWith('get_book_discovery', { p_book_id: id(1) });
	expect(api.abortSignal).toHaveBeenCalledWith(signal);
});

it.each([null, 'release'])('accepts empty lists with release %s', async (release_id) => {
	const api = client({ ...payload, release_id, similar_experience: [], different_direction: [] });
	expect(await loadBookDiscovery(api.supabase, id(1), new AbortController().signal)).toMatchObject({
		similarExperience: [],
		differentDirection: []
	});
});

it.each([
	{ ...payload, book_id: id(99) },
	{ ...payload, release_id: null },
	{ ...payload, similar_experience: [book(1)] },
	{ ...payload, different_direction: [book(2)] },
	{ ...payload, similar_experience: Array.from({ length: 6 }, (_, i) => book(i + 10)) },
	{ ...payload, different_direction: [{ ...book(4), slug: '../private' }] },
	{ ...payload, different_direction: [{ ...book(4), reason: null }] }
])(
	'rejects mismatched identities, unversioned data, self/duplicate targets and invalid public links',
	async (data) => {
		const api = client(data);
		await expect(
			loadBookDiscovery(api.supabase, id(1), new AbortController().signal)
		).rejects.toThrow();
	}
);

it('propagates errors and rejects aborted reads before and after the RPC', async () => {
	const failed = client(null, { message: 'Unavailable' });
	await expect(
		loadBookDiscovery(failed.supabase, id(1), new AbortController().signal)
	).rejects.toThrow('Unavailable');
	const controller = new AbortController();
	controller.abort();
	const api = client();
	await expect(loadBookDiscovery(api.supabase, id(1), controller.signal)).rejects.toThrow();
	expect(api.rpc).not.toHaveBeenCalled();
	const late = new AbortController();
	api.abortSignal.mockImplementation(async () => {
		late.abort();
		return { data: payload, error: null };
	});
	await expect(loadBookDiscovery(api.supabase, id(1), late.signal)).rejects.toThrow();
});

it('prefers unread books, then fills remaining slots with familiar books in server order', () => {
	const books = [2, 3, 4, 5, 6].map(book);
	expect(visibleDiscoveryBooks(books, new Set([id(2), id(4)]))).toEqual([
		book(3),
		book(5),
		book(6)
	]);
	expect(visibleDiscoveryBooks(books, new Set([id(2), id(3), id(4)]))).toEqual([
		book(5),
		book(6),
		book(2)
	]);
	expect(visibleDiscoveryBooks(books, new Set([id(2), id(3), id(4), id(5)]))).toEqual([
		book(6),
		book(2),
		book(3)
	]);
	expect(visibleDiscoveryBooks(books, new Set(books.map((book) => book.book_id)))).toEqual([
		book(2),
		book(3),
		book(4)
	]);
	expect(visibleDiscoveryBooks([book(2)], new Set([id(2)]))).toEqual([book(2)]);
	expect(visibleDiscoveryBooks([], new Set())).toEqual([]);
});

it('uses directional annotation wording and safely omits unknown explanations', () => {
	expect(
		discoveryReason({ code: 'dimension_contrast', params: { axis: 'pace', direction: -1 } })
	).toBe('More action-driven');
	expect(
		discoveryReason({ code: 'dimension_contrast', params: { axis: 'violence', direction: 1 } })
	).toBe('More graphic violence');
	expect(
		discoveryReason({
			code: 'genre_contrast',
			params: { family: 'science fiction', direction: -1 }
		})
	).toBe('Away from science fiction');
	expect(
		discoveryReason({
			code: 'format_contrast',
			params: { family: 'comics and manga', direction: 1 }
		})
	).toBe('Toward comics and manga');
	expect(discoveryReason(book(2).reason)).toBeNull();
	expect(discoveryReason({ code: 'future_reason', params: {} })).toBeNull();
	expect(
		discoveryReason({ code: 'dimension_contrast', params: { axis: '__proto__', direction: 1 } })
	).toBeNull();
	expect(
		discoveryReason({ code: 'genre_contrast', params: { family: 'unverified', direction: 1 } })
	).toBeNull();
});
