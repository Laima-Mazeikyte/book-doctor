import type { Book } from '$lib/types/book';

/** Public addresses come from the catalog; never guess a slug from mutable metadata. */
export function bookPath(book: Pick<Book, 'slug'>): `/books/${string}` {
	if (!book.slug) throw new Error('Missing public book slug');
	return `/books/${encodeURIComponent(book.slug)}`;
}
