import { writable } from 'svelte/store';
import type { Book } from '$lib/types/book';

/** While a rated-shelf summary sheet is open, holds the book so the row stays mounted after the rating is cleared. */
export const ratedSummarySheetKeepAlive = writable<{ bookId: string; book: Book } | null>(null);
