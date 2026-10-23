import type { Book } from '$lib/types/book';

/** The catalog ID owns identity; the slug is only a readable, replaceable label. */
export function bookSlug(title: string): string {
	const words =
		title
			.normalize('NFKD')
			.replace(/\p{M}/gu, '')
			.toLowerCase()
			.replace(/['’]/g, '')
			.match(/[\p{L}\p{N}]+/gu) ?? [];
	let slug = '';
	for (const word of words.slice(0, 6)) {
		const next = slug ? `${slug}-${word}` : word;
		if (next.length > 60) break;
		slug = next;
	}
	return slug || 'book';
}

export function bookPath(book: Pick<Book, 'book_id' | 'title'>): `/books/${string}/${string}` {
	return `/books/${encodeURIComponent(book.book_id)}/${encodeURIComponent(bookSlug(book.title))}`;
}
