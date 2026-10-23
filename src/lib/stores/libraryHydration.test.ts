import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Book } from '$lib/types/book';
import { librarySaves } from './librarySaves';
import { ratingsStore } from './ratings';
import { planToReadStore } from './planToRead';
import { notInterestedStore } from './notInterested';

const book: Book = {
	id: 'uuid-1',
	book_id: 'ulid-1',
	title: 'Locally saved book',
	author: 'Author'
};
const other: Book = { id: 'uuid-2', book_id: 'ulid-2', title: 'Other book', author: 'Author' };

function reset() {
	ratingsStore.setPersistence(null);
	planToReadStore.setPersistence(null);
	notInterestedStore.setPersistence(null);
	ratingsStore.reset();
	planToReadStore.reset();
	notInterestedStore.reset();
}

describe('library snapshots reconciled with local changes', () => {
	beforeEach(() => {
		librarySaves.activateOwner('hydration-A');
		reset();
	});
	afterEach(reset);

	it('keeps unsaved additions and their display metadata when empty server snapshots arrive', () => {
		ratingsStore.setRating(book.id, 5, book.book_id, book);
		planToReadStore.toggle(other.id, other.book_id, other);
		notInterestedStore.add('dismissed-ulid');
		ratingsStore.hydrate([]);
		ratingsStore.setRatedBooksDetails(new Map());
		planToReadStore.hydrate([]);
		notInterestedStore.hydrate([]);
		expect(get(ratingsStore).get(book.id)).toBe(5);
		expect(get(ratingsStore.ratedBooks)[0].book).toEqual(book);
		expect(planToReadStore.has(other.id)).toBe(true);
		expect(planToReadStore.mergeBooks([])).toEqual([other]);
		expect(notInterestedStore.has('dismissed-ulid')).toBe(true);
	});

	it('keeps explicit removals when a stale server snapshot or cached bookmark page contains the book', () => {
		ratingsStore.hydrate([{ bookId: book.id, rating: 4 }]);
		planToReadStore.hydrate([book.id], new Map([[book.id, book.book_id]]));
		notInterestedStore.hydrate([other.book_id]);
		ratingsStore.removeRating(book.id, book.book_id);
		planToReadStore.toggle(book.id);
		notInterestedStore.remove(other.book_id);
		ratingsStore.hydrate([{ bookId: book.id, rating: 4 }]);
		ratingsStore.setRatedBooksDetails(new Map([[book.id, book]]));
		planToReadStore.hydrate([book.id]);
		notInterestedStore.hydrate([other.book_id]);
		expect(get(ratingsStore).has(book.id)).toBe(false);
		expect(get(ratingsStore.ratedBooks)).toEqual([]);
		expect(planToReadStore.has(book.id)).toBe(false);
		expect(planToReadStore.mergeBooks([book])).toEqual([]);
		expect(notInterestedStore.has(other.book_id)).toBe(false);
	});

	it.each(['before the action', 'while saving'])(
		'protects acknowledged changes from reads started %s',
		async (phase) => {
			let readRevision = librarySaves.getRevision();
			ratingsStore.setPersistence({ set() {}, remove() {} });
			planToReadStore.setPersistence({ add() {}, remove() {} });
			notInterestedStore.setPersistence({ add() {}, remove() {} });
			ratingsStore.setRating(book.id, 3, book.book_id, book);
			planToReadStore.toggle(other.id, other.book_id, other);
			notInterestedStore.add('dismissed-ulid');
			if (phase === 'while saving') readRevision = librarySaves.getRevision();
			await librarySaves.flush();
			ratingsStore.hydrate([], readRevision);
			ratingsStore.setRatedBooksDetails(new Map(), readRevision);
			planToReadStore.hydrate([], new Map(), readRevision);
			notInterestedStore.hydrate([], readRevision);
			expect(get(ratingsStore).get(book.id)).toBe(3);
			expect(planToReadStore.has(other.id)).toBe(true);
			expect(notInterestedStore.has('dismissed-ulid')).toBe(true);
			expect(get(librarySaves).queuedCount).toBe(0);
		}
	);

	it('isolates visible intent by account and restores it for the original account', () => {
		ratingsStore.setRating(book.id, 4, book.book_id, book);
		planToReadStore.toggle(other.id, other.book_id, other);
		notInterestedStore.add('dismissed-ulid');
		librarySaves.activateOwner('hydration-B');
		expect(get(ratingsStore).size).toBe(0);
		expect(get(planToReadStore).size).toBe(0);
		expect(get(notInterestedStore).size).toBe(0);
		librarySaves.activateOwner('hydration-A');
		expect(get(ratingsStore).get(book.id)).toBe(4);
		expect(get(ratingsStore.ratedBooks)[0].book).toEqual(book);
		expect(planToReadStore.getBook(other.id)).toEqual(other);
		expect(notInterestedStore.has('dismissed-ulid')).toBe(true);
	});
});
