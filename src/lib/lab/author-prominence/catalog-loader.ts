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
