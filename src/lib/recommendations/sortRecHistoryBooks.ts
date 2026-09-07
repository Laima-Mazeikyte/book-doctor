import type { Book } from '$lib/types/book';

export const REC_SORT_IDS = ['newest', 'oldest', 'best-fit'] as const;
export type RecSortId = (typeof REC_SORT_IDS)[number];

export function isValidRecSortId(s: string | null | undefined): s is RecSortId {
	return s != null && (REC_SORT_IDS as readonly string[]).includes(s);
}

/**
 * `newest` / `oldest`: by last batch that included the book.
 * `best-fit`: more recommendation runs first, then best list position (rank 1 beats 10), then recency, then title.
 */
export function sortRecHistoryBooks(
	books: Book[],
	order: RecSortId,
	lastAt: Record<string, number>,
	appearances: Record<string, number>,
	bestRank: Record<string, number>
): Book[] {
	const arr = [...books];
	const key = (b: Book) => b.book_id;
	const ms = (b: Book) => lastAt[key(b)] ?? 0;
	const cnt = (b: Book) => appearances[key(b)] ?? 0;
	const br = (b: Book) => bestRank[key(b)] ?? 999;
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
	arr.sort((a, b) => {
		const dc = cnt(b) - cnt(a);
		if (dc !== 0) return dc;
		const dr = br(a) - br(b);
		if (dr !== 0) return dr;
		const dm = ms(b) - ms(a);
		if (dm !== 0) return dm;
		return titleCmp(a, b);
	});
	return arr;
}
