import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	bookSummarySheetHistory,
	clearBookSummarySheetHistory,
	createBookSummarySheetOwnerId,
	ownsBookSummarySheet
} from './bookSummarySheetHistory';

describe('book summary sheet ownership', () => {
	beforeEach(() => {
		bookSummarySheetHistory.set(null);
	});

	it('creates a distinct owner identity for each sheet owner', () => {
		const first = createBookSummarySheetOwnerId();
		const second = createBookSummarySheetOwnerId();

		expect(first).not.toBe(second);
		expect(ownsBookSummarySheet({ ownerId: first }, first)).toBe(true);
		expect(ownsBookSummarySheet({ ownerId: second }, first)).toBe(false);
	});

	it('does not allow one owner to clear another owner entry', () => {
		const owner = createBookSummarySheetOwnerId();
		const otherOwner = createBookSummarySheetOwnerId();
		const applyClose = vi.fn();
		bookSummarySheetHistory.set({
			ownerId: owner,
			bookUlid: '01KR2ADTNG29NSQV23VAGV8FXB',
			applyClose
		});

		clearBookSummarySheetHistory(otherOwner);
		expect(get(bookSummarySheetHistory)?.ownerId).toBe(owner);
		expect(applyClose).not.toHaveBeenCalled();

		clearBookSummarySheetHistory(owner);
		expect(get(bookSummarySheetHistory)).toBeNull();
	});
});
