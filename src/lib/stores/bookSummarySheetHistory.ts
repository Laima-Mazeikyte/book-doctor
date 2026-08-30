import { get, writable } from 'svelte/store';

/**
 * The currently open shallow book-sheet entry. Pages use this to apply a browser Back close
 * without navigating back a second time.
 */
export interface BookSummarySheetHistoryEntry {
	ownerId: string;
	bookUlid: string;
	applyClose: () => void;
}

export const bookSummarySheetHistory = writable<BookSummarySheetHistoryEntry | null>(null);

type BookSummarySheetOwnerValue = { ownerId?: string } | null | undefined;

let ownerSequence = 0;

/** Create one stable identity for a sheet-owning component instance. */
export function createBookSummarySheetOwnerId(): string {
	ownerSequence += 1;
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `book-summary-${crypto.randomUUID()}`;
	}
	return `book-summary-${Date.now().toString(36)}-${ownerSequence.toString(36)}`;
}

export function ownsBookSummarySheet(value: BookSummarySheetOwnerValue, ownerId: string): boolean {
	return value?.ownerId === ownerId;
}

/** Clear only the coordination entry created by this sheet owner. */
export function clearBookSummarySheetHistory(ownerId: string): void {
	const current = get(bookSummarySheetHistory);
	if (ownsBookSummarySheet(current, ownerId)) bookSummarySheetHistory.set(null);
}

/** Consume this owner's shallow entry and resolve after the browser applies Back. */
export function consumeBookSummaryHistoryEntry(ownerId: string): Promise<void> {
	if (
		!ownsBookSummarySheet(get(bookSummarySheetHistory), ownerId) ||
		typeof window === 'undefined'
	) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const onPopState = () => {
			window.removeEventListener('popstate', onPopState);
			resolve();
		};
		window.addEventListener('popstate', onPopState, { once: true });
		window.history.back();
	});
}
