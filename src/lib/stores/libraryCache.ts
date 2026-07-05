import type { RatingValue } from '$lib/types/book';

/**
 * Local snapshot of the user's rated library, persisted to localStorage so the bookshelf can
 * paint instantly on load (stale-while-revalidate) instead of waiting for the network.
 *
 * Deliberately minimal — only the fields the grid card renders. `coverUrl` is re-derived from
 * `book_id` on read; genres/summary/year are fetched on demand when a book is expanded.
 */

const KEY_PREFIX = 'book-doctor:library-cache:v1:';

export interface CachedRatedBook {
	id: string;
	book_id: string;
	title: string;
	author: string;
	rating: RatingValue;
}

function keyFor(userId: string): string {
	return `${KEY_PREFIX}${userId}`;
}

function isValidRating(v: unknown): v is RatingValue {
	return v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
}

/** Read + validate the cached snapshot for a user. Returns null on miss or malformed data. */
export function readLibraryCache(userId: string | null | undefined): CachedRatedBook[] | null {
	if (!userId || typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(keyFor(userId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return null;
		const out: CachedRatedBook[] = [];
		for (const entry of parsed) {
			if (!entry || typeof entry !== 'object') continue;
			const c = entry as Partial<CachedRatedBook>;
			if (
				typeof c.id !== 'string' ||
				typeof c.book_id !== 'string' ||
				typeof c.title !== 'string' ||
				typeof c.author !== 'string' ||
				!isValidRating(c.rating)
			) {
				continue;
			}
			out.push({ id: c.id, book_id: c.book_id, title: c.title, author: c.author, rating: c.rating });
		}
		return out;
	} catch {
		return null;
	}
}

/** Persist the snapshot for a user. Callers should avoid writing an empty list (see the store). */
export function writeLibraryCache(
	userId: string | null | undefined,
	entries: CachedRatedBook[]
): void {
	if (!userId || typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(keyFor(userId), JSON.stringify(entries));
	} catch {
		// ignore quota / serialization failures — the cache is best-effort
	}
}

/** Clear one user's cache, or every library cache when no userId is given (e.g. on sign-out). */
export function clearLibraryCache(userId?: string | null): void {
	if (typeof window === 'undefined') return;
	try {
		if (userId) {
			window.localStorage.removeItem(keyFor(userId));
			return;
		}
		const toRemove: string[] = [];
		for (let i = 0; i < window.localStorage.length; i++) {
			const k = window.localStorage.key(i);
			if (k && k.startsWith(KEY_PREFIX)) toRemove.push(k);
		}
		for (const k of toRemove) window.localStorage.removeItem(k);
	} catch {
		// ignore
	}
}
