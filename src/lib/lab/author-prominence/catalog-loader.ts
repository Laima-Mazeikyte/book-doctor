import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '$lib/supabase';
import type { Book } from '$lib/types/book';
import { resolveBooksByIdsInOrder } from '$lib/search/resolveBooksFromSupabase';

export class AuthorProminenceCatalogLoader {
	private readonly supabase: SupabaseClient | null;
	private readonly cache = new Map<string, Promise<Book>>();

	constructor(supabase: SupabaseClient | null = getSupabase()) {
		this.supabase = supabase;
	}

	get cachedBookCount(): number {
		return this.cache.size;
	}

	/**
	 * Resolve several books in one request, for callers that know the whole set up front —
	 * every volume of a series, say. Results share the single-book cache, so a book already
	 * loaded is not requested again and a later single `load` of any of these is free.
	 */
	loadMany(bookUlids: string[]): Promise<Array<Book | null>> {
		const normalized = bookUlids.map((ulid) => ulid.trim().toUpperCase());
		const missing = [...new Set(normalized.filter((ulid) => ulid && !this.cache.has(ulid)))];
		if (missing.length > 0 && this.supabase) {
			const request = resolveBooksByIdsInOrder(this.supabase, missing);
			for (const ulid of missing) {
				const entry = request
					.then((books) => {
						const book = books.find((candidate) => candidate.book_id.toUpperCase() === ulid);
						if (!book) throw new Error(`Book not found for catalog id ${ulid}.`);
						return book;
					})
					.catch((error) => {
						if (this.cache.get(ulid) === entry) this.cache.delete(ulid);
						throw error;
					});
				this.cache.set(ulid, entry);
			}
		}
		// A book the catalog does not carry resolves to null: one absent volume must not take
		// the rest of the set down with it.
		return Promise.all(
			normalized.map((ulid) => (ulid ? this.load(ulid).catch(() => null) : Promise.resolve(null)))
		);
	}

	load(bookUlid: string): Promise<Book> {
		const normalizedUlid = bookUlid.trim().toUpperCase();
		if (!normalizedUlid) return Promise.reject(new Error('A book ULID is required.'));

		const cached = this.cache.get(normalizedUlid);
		if (cached) return cached;
		if (!this.supabase) {
			return Promise.reject(new Error('The book catalog is unavailable in this browser.'));
		}

		const request = resolveBooksByIdsInOrder(this.supabase, [normalizedUlid])
			.then((books) => {
				const book = books[0];
				if (!book) throw new Error(`Book not found for catalog id ${normalizedUlid}.`);
				return book;
			})
			.catch((error) => {
				if (this.cache.get(normalizedUlid) === request) this.cache.delete(normalizedUlid);
				throw error;
			});

		this.cache.set(normalizedUlid, request);
		return request;
	}

	destroy(): void {
		this.cache.clear();
	}
}

export function createAuthorProminenceCatalogLoader(
	supabase: SupabaseClient | null = getSupabase()
): AuthorProminenceCatalogLoader {
	return new AuthorProminenceCatalogLoader(supabase);
}
