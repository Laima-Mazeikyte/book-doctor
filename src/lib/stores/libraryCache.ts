import type { RatingValue } from '$lib/types/book';

/**
 * Local snapshot of the user's rated library, persisted to localStorage so the bookshelf can
 * paint instantly on load (stale-while-revalidate) instead of waiting for the network.
 *
 * Deliberately minimal — only the fields the grid card renders. `coverUrl` is re-derived from
 * `book_id` on read; genres/summary/year are fetched on demand when a book is expanded.
 */

const KEY_PREFIX = 'book-doctor:library-cache:v1:';
export const LIBRARY_SNAPSHOT_PREFIX = 'book-doctor:library-cache:v2:';
const MAX_CACHE_CHARS = 4_000_000;
const MAX_ENTRIES = 50_000;

export interface CachedBookId {
	id: string;
	book_id: string;
}
export interface CachedRating extends CachedBookId {
	rating: RatingValue;
}
export interface LibrarySnapshotCollections {
	// Presence means a complete collection. Missing and successfully empty differ.
	ratings?: { entries: CachedRating[]; books: CachedRatedBook[] };
	bookmarks?: CachedBookId[];
	dismissals?: string[];
}
interface LibrarySnapshot {
	version: 2;
	ownerId: string;
	collections: LibrarySnapshotCollections;
}

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
			out.push({
				id: c.id,
				book_id: c.book_id,
				title: c.title,
				author: c.author,
				rating: c.rating
			});
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
			window.localStorage.removeItem(LIBRARY_SNAPSHOT_PREFIX + userId);
			return;
		}
		const toRemove: string[] = [];
		for (let i = 0; i < window.localStorage.length; i++) {
			const k = window.localStorage.key(i);
			if (k && (k.startsWith(KEY_PREFIX) || k.startsWith(LIBRARY_SNAPSHOT_PREFIX)))
				toRemove.push(k);
		}
		for (const k of toRemove) window.localStorage.removeItem(k);
	} catch {
		// ignore
	}
}

function object(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
function identifier(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 200;
}
function bookId(value: unknown): value is CachedBookId {
	return object(value) && identifier(value.id) && identifier(value.book_id);
}
function uniqueArray<T>(
	value: unknown,
	valid: (row: unknown) => row is T,
	key: (row: T) => string
): value is T[] {
	return (
		Array.isArray(value) &&
		value.length <= MAX_ENTRIES &&
		value.every(valid) &&
		new Set(value.map(key)).size === value.length
	);
}
function validIds(value: unknown): value is CachedBookId[] {
	return (
		uniqueArray(value, bookId, (row) => row.id) &&
		new Set(value.map((row) => row.book_id)).size === value.length
	);
}
function validRatings(value: unknown): value is NonNullable<LibrarySnapshotCollections['ratings']> {
	if (
		!object(value) ||
		!validIds(value.entries) ||
		!value.entries.every((row) => isValidRating((row as CachedRating).rating))
	)
		return false;
	const entries = new Map((value.entries as CachedRating[]).map((row) => [row.id, row]));
	return uniqueArray(
		value.books,
		(row): row is CachedRatedBook => {
			if (!bookId(row) || !object(row)) return false;
			const entry = entries.get(row.id);
			return (
				entry?.book_id === row.book_id &&
				entry.rating === row.rating &&
				typeof row.title === 'string' &&
				row.title.length <= 2000 &&
				typeof row.author === 'string' &&
				row.author.length <= 2000
			);
		},
		(row) => row.id
	);
}
function validatedCollections(value: unknown): LibrarySnapshotCollections {
	if (!object(value)) return {};
	const result: LibrarySnapshotCollections = {};
	// Reject a whole malformed collection; never turn a valid subset into completeness.
	if (validRatings(value.ratings)) result.ratings = value.ratings;
	if (validIds(value.bookmarks)) result.bookmarks = value.bookmarks;
	if (uniqueArray(value.dismissals, identifier, (id) => id)) result.dismissals = value.dismissals;
	return result;
}

export function readLibrarySnapshot(userId: string): LibrarySnapshotCollections {
	if (!userId || typeof window === 'undefined') return {};
	try {
		const raw = window.localStorage.getItem(LIBRARY_SNAPSHOT_PREFIX + userId);
		if (!raw || raw.length > MAX_CACHE_CHARS) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!object(parsed) || parsed.version !== 2 || parsed.ownerId !== userId) return {};
		return validatedCollections(parsed.collections);
	} catch {
		return {};
	}
}

/** Merge only complete, valid collections. An unavailable collection never erases a prior one. */
export function writeLibrarySnapshot(userId: string, patch: LibrarySnapshotCollections): void {
	if (!userId || typeof window === 'undefined') return;
	try {
		const collections = { ...readLibrarySnapshot(userId), ...validatedCollections(patch) };
		if (!Object.keys(collections).length) return;
		const snapshot: LibrarySnapshot = { version: 2, ownerId: userId, collections };
		const raw = JSON.stringify(snapshot);
		const key = LIBRARY_SNAPSHOT_PREFIX + userId;
		if (raw.length <= MAX_CACHE_CHARS && window.localStorage.getItem(key) !== raw) {
			window.localStorage.setItem(key, raw);
		}
	} catch {
		// Storage is disposable; pending-save journals remain independent.
	}
}

export function isLibraryCacheEvent(key: string | null, userId: string): boolean {
	return key === null || key === LIBRARY_SNAPSHOT_PREFIX + userId || key === keyFor(userId);
}
