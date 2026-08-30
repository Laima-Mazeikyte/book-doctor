import { get } from 'svelte/store';
import { ensureAnonymousSessionStarted } from '$lib/auth/anonymous-session';
import { notInterestedStore } from './notInterested';
import { planToReadStore } from './planToRead';
import { ratingsStore } from './ratings';
import type { Book, RatingValue } from '$lib/types/book';

function startAnonymousPersistence(): void {
	void ensureAnonymousSessionStarted();
}

/** Toggle a bookmark using the UUID for local state and ULID for persistence. */
export function toggleBookmarked(book: Book): boolean {
	const wasBookmarked = planToReadStore.has(book.id);
	planToReadStore.toggle(book.id, book.book_id);
	if (!wasBookmarked) notInterestedStore.remove(book.book_id);
	startAnonymousPersistence();
	return !wasBookmarked;
}

/** Toggle not-interested and clear every conflicting library action when adding it. */
export function toggleNotInterested(book: Book): boolean {
	const nowNotInterested = notInterestedStore.toggle(book.book_id);
	if (nowNotInterested) {
		if (planToReadStore.has(book.id)) planToReadStore.toggle(book.id, book.book_id);
		if (get(ratingsStore).has(book.id)) ratingsStore.removeRating(book.id, book.book_id);
	}
	startAnonymousPersistence();
	return nowNotInterested;
}

/** Set a rating; rating-store behavior removes not-interested for the same ULID. */
export function setBookRating(book: Book, value: RatingValue): void {
	ratingsStore.setRating(book.id, value, book.book_id, book);
	startAnonymousPersistence();
}

/** Remove a rating using both canonical book identifiers. */
export function removeBookRating(book: Book): void {
	ratingsStore.removeRating(book.id, book.book_id);
	startAnonymousPersistence();
}

/** Clicking the current rating clears it; another value replaces it. */
export function toggleBookRating(book: Book, value: RatingValue): void {
	if (get(ratingsStore).get(book.id) === value) removeBookRating(book);
	else setBookRating(book, value);
}
