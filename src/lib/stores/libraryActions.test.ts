import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Book } from '$lib/types/book';

const ensureAnonymousSessionStarted = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('$lib/auth/anonymous-session', () => ({ ensureAnonymousSessionStarted }));

import {
	removeBookRating,
	setBookRating,
	toggleBookmarked,
	toggleBookRating,
	toggleNotInterested
} from './libraryActions';
import { notInterestedStore } from './notInterested';
import { planToReadStore } from './planToRead';
import { ratingsStore } from './ratings';

const book: Book = {
	id: 'uuid-book-1',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	title: 'A book',
	author: 'An author'
};

describe('shared library actions', () => {
	beforeEach(() => {
		planToReadStore.reset();
		notInterestedStore.reset();
		ratingsStore.reset();
		ensureAnonymousSessionStarted.mockClear();
	});

	it('uses UUID state and ULID persistence when bookmarking', () => {
		notInterestedStore.add(book.book_id);

		expect(toggleBookmarked(book)).toBe(true);
		expect(planToReadStore.has(book.id)).toBe(true);
		expect(notInterestedStore.has(book.book_id)).toBe(false);
		expect(ensureAnonymousSessionStarted).toHaveBeenCalledTimes(1);

		expect(toggleBookmarked(book)).toBe(false);
		expect(planToReadStore.has(book.id)).toBe(false);
	});

	it('clears bookmark and rating when adding not interested', () => {
		planToReadStore.toggle(book.id, book.book_id);
		ratingsStore.setRating(book.id, 4, book.book_id, book);

		expect(toggleNotInterested(book)).toBe(true);
		expect(notInterestedStore.has(book.book_id)).toBe(true);
		expect(planToReadStore.has(book.id)).toBe(false);
		expect(get(ratingsStore).has(book.id)).toBe(false);

		expect(toggleNotInterested(book)).toBe(false);
		expect(notInterestedStore.has(book.book_id)).toBe(false);
	});

	it('removes not interested when setting a rating and clears the current rating', () => {
		notInterestedStore.add(book.book_id);
		setBookRating(book, 5);
		expect(get(ratingsStore).get(book.id)).toBe(5);
		expect(notInterestedStore.has(book.book_id)).toBe(false);

		toggleBookRating(book, 5);
		expect(get(ratingsStore).has(book.id)).toBe(false);
		expect(ensureAnonymousSessionStarted).toHaveBeenCalledTimes(2);

		setBookRating(book, 2);
		removeBookRating(book);
		expect(get(ratingsStore).has(book.id)).toBe(false);
	});
});
