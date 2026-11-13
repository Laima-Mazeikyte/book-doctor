import type { Book } from '$lib/types/book';

export const REC_SORT_IDS = ['newest', 'oldest'] as const;
export type RecSortId = (typeof REC_SORT_IDS)[number];

export function isValidRecSortId(s: string | null | undefined): s is RecSortId {
	return s != null && (REC_SORT_IDS as readonly string[]).includes(s);
}

/**
 * `newest` / `oldest`: by last batch that included the book.
 */
export function sortRecHistoryBooks(
	books: Book[],
	order: RecSortId,
	lastAt: Record<string, number>
): Book[] {
	const arr = [...books];
	const key = (b: Book) => b.book_id;
	const ms = (b: Book) => lastAt[key(b)] ?? 0;
	const titleCmp = (a: Book, b: Book) => (a.title ?? '').localeCompare(b.title ?? '');

	if (order === 'newest') {
		arr.sort((a, b) => {
			const diff = ms(b) - ms(a);
			if (diff !== 0) return diff;
			return titleCmp(a, b);
		});
		return arr;
	}
	if (order === 'oldest') {
		arr.sort((a, b) => {
			const diff = ms(a) - ms(b);
			if (diff !== 0) return diff;
			return titleCmp(a, b);
		});
		return arr;
	}
	return arr;
}
