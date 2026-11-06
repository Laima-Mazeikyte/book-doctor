import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Book } from '$lib/types/book';
import { loadBookConnections } from './connections';

const target = '01KR2ADTNG29NSQV23VAGV8FXB';
const first: Book = {
	id: 'uuid-one',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXC',
	slug: 'first-book',
	title: 'First Book',
	author: 'First Author'
};
const second: Book = {
	...first,
	id: 'uuid-two',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXD',
	slug: 'second-book',
	title: 'Second Book'
};
const payload = {
	book_id: target,
	release_id: 'book-connections-int8-v2',
	status: 'computed',
	connections: [
		{ book_id: second.book_id, similarity: 0.72, rating: 2 },
		{ book_id: first.book_id, similarity: 0.69, rating: 5 }
	]
};
function client(data: unknown = payload) {
	const rpcResult = vi.fn().mockResolvedValue({ data, error: null });
	const metadataResult = vi.fn().mockResolvedValue({
		data: [first, second].map((book) => ({
			id: book.id,
			book_id: book.book_id,
			slug: book.slug,
			book_name: book.title,
			author: book.author
		})),
		error: null
	});
	const lookup = vi.fn().mockReturnValue({ abortSignal: metadataResult });
	const select = vi.fn().mockReturnValue({ in: lookup });
	const from = vi.fn().mockReturnValue({ select });
	const rpc = vi.fn().mockReturnValue({ abortSignal: rpcResult });
	return {
		supabase: { rpc, from } as unknown as SupabaseClient,
		rpc,
		from,
		select,
		lookup,
		rpcResult,
		metadataResult
	};
}

it('calls the authenticated RPC without a user ID and preserves server order and low ratings', async () => {
	const api = client();
	const signal = new AbortController().signal;
	const result = await loadBookConnections(api.supabase, target, signal);
	expect(api.rpc).toHaveBeenCalledWith('get_book_connections', { p_book_id: target, p_limit: 3 });
	expect(api.rpcResult).toHaveBeenCalledWith(expect.any(AbortSignal));
	expect(api.select).toHaveBeenCalledWith('id,book_id,slug,book_name,author');
	expect(api.lookup).toHaveBeenCalledWith('book_id', [second.book_id, first.book_id]);
	expect(api.metadataResult).toHaveBeenCalledWith(api.rpcResult.mock.calls[0][0]);
	expect(result).toEqual([
		{ book: second, rating: 2 },
		{ book: first, rating: 5 }
	]);
});

it('uses complete cached metadata and resolves only missing slugs', async () => {
	const api = client();
	await loadBookConnections(api.supabase, target, new AbortController().signal, [
		second,
		{ ...first, slug: undefined }
	]);
	expect(api.lookup).toHaveBeenCalledWith('book_id', [first.book_id]);
	const cached = client();
	expect(
		await loadBookConnections(cached.supabase, target, new AbortController().signal, [
			first,
			second
		])
	).toEqual([
		{ book: second, rating: 2 },
		{ book: first, rating: 5 }
	]);
	expect(cached.from).not.toHaveBeenCalled();
});

it.each(['computed', 'target_unavailable'])(
	'omits empty %s results without a catalog request',
	async (status) => {
		const api = client({ ...payload, status, connections: [] });
		expect(await loadBookConnections(api.supabase, target, new AbortController().signal)).toEqual(
			[]
		);
		expect(api.from).not.toHaveBeenCalled();
	}
);

it('omits catalog entries that cannot be resolved to a real public link', async () => {
	const api = client();
	api.metadataResult.mockResolvedValue({
		data: [
			{
				id: first.id,
				book_id: first.book_id,
				book_name: first.title,
				author: first.author,
				slug: null
			}
		],
		error: null
	});
	expect(await loadBookConnections(api.supabase, target, new AbortController().signal)).toEqual([]);
});

it('propagates RPC and metadata failures rather than treating them as empty connections', async () => {
	const api = client();
	api.rpcResult.mockResolvedValue({ data: null, error: { message: 'RPC not installed' } });
	await expect(
		loadBookConnections(api.supabase, target, new AbortController().signal)
	).rejects.toThrow('RPC not installed');
	expect(api.from).not.toHaveBeenCalled();
	const metadata = client();
	metadata.metadataResult.mockResolvedValue({
		data: null,
		error: { message: 'Metadata unavailable' }
	});
	await expect(
		loadBookConnections(metadata.supabase, target, new AbortController().signal)
	).rejects.toThrow('Metadata unavailable');
});

it('rejects a response for a different target', async () => {
	const api = client({ ...payload, book_id: first.book_id });
	await expect(
		loadBookConnections(api.supabase, target, new AbortController().signal)
	).rejects.toThrow('Invalid book connections response');
	expect(api.from).not.toHaveBeenCalled();
});

it('does not start metadata resolution after cancellation and rejects late metadata', async () => {
	const api = client();
	const controller = new AbortController();
	controller.abort();
	await expect(loadBookConnections(api.supabase, target, controller.signal)).rejects.toMatchObject({
		name: 'AbortError'
	});
	expect(api.from).not.toHaveBeenCalled();
	const next = client();
	const nextController = new AbortController();
	next.metadataResult.mockImplementation(async () => {
		nextController.abort();
		return { data: [], error: null };
	});
	await expect(
		loadBookConnections(next.supabase, target, nextController.signal)
	).rejects.toMatchObject({ name: 'AbortError' });
});

it('shares a deadline across selection and metadata, and ignores late metadata', async () => {
	vi.useFakeTimers();
	const api = client();
	const parent = new AbortController();
	api.rpcResult.mockImplementation(async () => {
		await new Promise((resolve) => setTimeout(resolve, 12_000));
		return { data: payload, error: null };
	});
	api.metadataResult.mockImplementation(() => new Promise(() => {}));
	try {
		const pending = loadBookConnections(api.supabase, target, parent.signal);
		const assertion = expect(pending).rejects.toMatchObject({ name: 'RequestTimeoutError' });
		await vi.advanceTimersByTimeAsync(15_000);
		await assertion;
		expect(api.metadataResult).toHaveBeenCalledTimes(1);
		expect(api.metadataResult.mock.calls[0][0].aborted).toBe(true);
		expect(parent.signal.aborted).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		vi.useRealTimers();
	}
});
