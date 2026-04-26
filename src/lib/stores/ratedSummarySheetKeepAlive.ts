import { writable } from 'svelte/store';
import type { Book } from '$lib/types/book';

/**
 * While a summary sheet is open, holds the book so the grid row stays mounted when an action
 * would remove it from the list (e.g. clear rating on bookshelf, or mark not interested on recommendations).
 */
export const ratedSummarySheetKeepAlive = writable<{ bookId: string; book: Book } | null>(null);
