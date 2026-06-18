import type { Book } from '$lib/types/book';

export const SHORTLIST_VISIBLE_COUNT = 7;
export const SHORTLIST_MAX_INSERTIONS = 2;
export const SHORTLIST_NEW_REC_NI_THRESHOLD = 3;

export type NotInterestedOverlay = 'replace' | 'new-rec' | null;

export function splitShortlistBooks(all: Book[]): { visible: Book[]; reserve: Book[] } {
	return {
		visible: all.slice(0, SHORTLIST_VISIBLE_COUNT),
		reserve: all.slice(SHORTLIST_VISIBLE_COUNT)
	};
}

/** Inserts the next reserve book immediately after `index`; dismissed book stays in place. */
export function insertBookAfterIndex(
	visible: Book[],
	index: number,
	reserve: Book[]
): { visible: Book[]; reserve: Book[]; incoming: Book | null } {
	if (index < 0 || index >= visible.length || reserve.length === 0) {
		return { visible, reserve, incoming: null };
	}

	const incoming = reserve[0] ?? null;
	if (!incoming) {
		return { visible, reserve, incoming: null };
	}

	const nextVisible = [...visible];
	nextVisible.splice(index + 1, 0, incoming);

	return {
		visible: nextVisible,
		reserve: reserve.slice(1),
		incoming
	};
}

export function overlayForDismissedBook(
	dismissalOrdinal: number | undefined,
	reserveCount: number,
	insertionsUsed: number,
	sessionNiCount: number
): NotInterestedOverlay {
	if (dismissalOrdinal == null || dismissalOrdinal < 1) return null;
	if (sessionNiCount >= SHORTLIST_NEW_REC_NI_THRESHOLD) return 'new-rec';
	if (insertionsUsed < SHORTLIST_MAX_INSERTIONS && reserveCount > 0) return 'replace';
	return 'new-rec';
}
