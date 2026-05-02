import { writable } from 'svelte/store';

/** While a /rate book summary sheet is open, browser Back applies this close (sync, no `history.back`). */
export type RateBookSummaryHistoryEntry = {
	bookId: string;
	applyClose: () => void;
};

export const rateBookSummaryHistory = writable<RateBookSummaryHistoryEntry | null>(null);
