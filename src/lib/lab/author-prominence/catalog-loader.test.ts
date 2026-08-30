import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Book } from '$lib/types/book';

const mocks = vi.hoisted(() => ({
	getSupabase: vi.fn(),
	resolveBooksByIdsInOrder: vi.fn()
}));

vi.mock('$lib/supabase', () => ({ getSupabase: mocks.getSupabase }));
vi.mock('$lib/search/resolveBooksFromSupabase', () => ({
	resolveBooksByIdsInOrder: mocks.resolveBooksByIdsInOrder
}));

import {
	AuthorProminenceCatalogLoader,
	createAuthorProminenceCatalogLoader
} from './catalog-loader';

const book: Book = {
	id: 'uuid-book-1',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	title: 'A book',
	author: 'An author',
	coverUrl: '/cover.jpg',
	summary: 'A summary'
};

const client = {} as SupabaseClient;

describe('AuthorProminenceCatalogLoader', () => {
	beforeEach(() => {
		mocks.getSupabase.mockReset();
		mocks.resolveBooksByIdsInOrder.mockReset();
		mocks.getSupabase.mockReturnValue(client);
	});

	it('uses the browser Supabase client and normalizes one ULID request', async () => {
		mocks.resolveBooksByIdsInOrder.mockResolvedValue([book]);
		const loader = createAuthorProminenceCatalogLoader();

		await expect(loader.load(` ${book.book_id.toLowerCase()} `)).resolves.toBe(book);
		expect(mocks.getSupabase).toHaveBeenCalledTimes(1);
		expect(mocks.resolveBooksByIdsInOrder).toHaveBeenCalledWith(client, [book.book_id]);
	});

	it('shares in-flight work and reuses successful catalog entries', async () => {
		let resolveRequest!: (books: Book[]) => void;
		mocks.resolveBooksByIdsInOrder.mockReturnValue(
			new Promise<Book[]>((resolve) => {
				resolveRequest = resolve;
			})
		);
		const loader = new AuthorProminenceCatalogLoader(client);

		const first = loader.load(book.book_id);
		const second = loader.load(book.book_id.toLowerCase());
		expect(second).toBe(first);
		expect(loader.cachedBookCount).toBe(1);

		resolveRequest([book]);
		await expect(first).resolves.toBe(book);
		await expect(loader.load(book.book_id)).resolves.toBe(book);
		expect(mocks.resolveBooksByIdsInOrder).toHaveBeenCalledTimes(1);
	});

	it('evicts failed work so a later activation can retry', async () => {
		mocks.resolveBooksByIdsInOrder
			.mockRejectedValueOnce(new Error('temporary catalog failure'))
			.mockResolvedValueOnce([book]);
		const loader = new AuthorProminenceCatalogLoader(client);

		await expect(loader.load(book.book_id)).rejects.toThrow('temporary catalog failure');
		expect(loader.cachedBookCount).toBe(0);
		await expect(loader.load(book.book_id)).resolves.toBe(book);
		expect(mocks.resolveBooksByIdsInOrder).toHaveBeenCalledTimes(2);
	});

	it('turns an empty ordered result into a descriptive not-found failure', async () => {
		mocks.resolveBooksByIdsInOrder.mockResolvedValue([]);
		const loader = new AuthorProminenceCatalogLoader(client);

		await expect(loader.load(book.book_id)).rejects.toThrow(
			`Book not found for catalog id ${book.book_id}.`
		);
	});

	it('clears page-scoped cache entries on destroy', async () => {
		mocks.resolveBooksByIdsInOrder.mockResolvedValue([book]);
		const loader = new AuthorProminenceCatalogLoader(client);

		await loader.load(book.book_id);
		loader.destroy();
		await loader.load(book.book_id);
		expect(mocks.resolveBooksByIdsInOrder).toHaveBeenCalledTimes(2);
	});
});
