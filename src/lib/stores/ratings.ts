import { derived, get, writable } from 'svelte/store';
import type { Book, RatingValue } from '$lib/types/book';
import { coverUrlForBookId } from '$lib/book-cover';
import { notInterestedStore } from './notInterested';
import type { CachedRatedBook } from './libraryCache';
import { librarySaves } from './librarySaves';

export interface RatingsPersistence {
	set(bookUlid: string, value: RatingValue, signal?: AbortSignal): void | Promise<void>;
	remove(bookUlid: string, signal?: AbortSignal): void | Promise<void>;
}
export type RatingSyncState = 'saved' | 'pending' | 'failed' | 'idle';

function createRatingsStore() {
	const values = writable<Map<string, RatingValue>>(new Map());
	const details = writable<Map<string, Book>>(new Map());
	const ratedBooks = derived([values, details], ([$values, $details]) =>
		[...$values].flatMap(([id, rating]) => {
			const book = $details.get(id);
			return book ? [{ book, rating }] : [];
		})
	);
	const syncMeta = derived(librarySaves, (snapshot) => {
		const changes = snapshot.changes.filter((c) => c.kind === 'rating');
		const failedCount = changes.filter((c) => c.status === 'failed').length;
		return {
			queuedCount: changes.length,
			failedCount,
			pendingCount: changes.length - failedCount,
			isFlushing: changes.some((c) => c.status === 'saving')
		};
	});
	const syncStates = derived([values, librarySaves], ([$values, snapshot]) => {
		const states = new Map<string, RatingSyncState>([...$values.keys()].map((id) => [id, 'saved']));
		for (const c of snapshot.changes)
			if (c.kind === 'rating' && c.bookId)
				states.set(c.bookId, c.status === 'failed' ? 'failed' : 'pending');
		return states;
	});
	function overlay(readRevision: number) {
		const changes = librarySaves.overlays('rating', readRevision);
		if (!changes.length) return;
		values.update((current) => {
			const next = new Map(current);
			for (const c of changes) {
				if (!c.bookId) continue;
				if (c.value === null) next.delete(c.bookId);
				else next.set(c.bookId, c.value as RatingValue);
			}
			return next;
		});
		details.update((current) => {
			const next = new Map(current);
			for (const c of changes) {
				if (!c.bookId) continue;
				if (c.value === null) next.delete(c.bookId);
				else if (c.book) next.set(c.bookId, c.book);
			}
			return next;
		});
	}
	let owner = librarySaves.getOwner();
	let appliedRevision = -1;
	librarySaves.subscribe((snapshot) => {
		if (snapshot.ownerId !== owner) {
			owner = snapshot.ownerId;
			appliedRevision = -1;
			values.set(new Map());
			details.set(new Map());
		}
		overlay(appliedRevision);
		appliedRevision = librarySaves.getRevision();
	});
	return {
		subscribe: values.subscribe,
		ratedBooksDetails: { subscribe: details.subscribe },
		ratedBooks: { subscribe: ratedBooks.subscribe },
		syncStates: { subscribe: syncStates.subscribe },
		syncMeta: { subscribe: syncMeta.subscribe },
		setPersistence(p: RatingsPersistence | null, userId?: string) {
			librarySaves.setWriter(
				'rating',
				p
					? (c, signal) =>
							c.value === null
								? p.remove(c.bookUlid, signal)
								: p.set(c.bookUlid, c.value as RatingValue, signal)
					: null,
				userId
			);
		},
		setRatedBooksDetails(books: Map<string, Book>, readRevision = librarySaves.getRevision()) {
			details.set(new Map(books));
			overlay(readRevision);
		},
		getRatedBook(bookId: string) {
			return get(details).get(bookId);
		},
		getSyncState(bookId: string): RatingSyncState {
			return get(syncStates).get(bookId) ?? 'idle';
		},
		hydrate(
			entries: Array<{ bookId: string; rating: RatingValue }>,
			readRevision = librarySaves.getRevision()
		) {
			values.set(new Map(entries.map((e) => [e.bookId, e.rating])));
			overlay(readRevision);
		},
		hydrateFromCache(entries: CachedRatedBook[]) {
			if (!entries.length) return;
			values.set(new Map(entries.map((e) => [e.id, e.rating])));
			details.set(
				new Map(
					entries.map((e) => [
						e.id,
						{
							id: e.id,
							book_id: e.book_id,
							title: e.title,
							author: e.author,
							coverUrl: coverUrlForBookId(e.book_id)
						}
					])
				)
			);
			overlay(-1);
		},
		flushPending() {
			return librarySaves.flush('rating');
		},
		retryPending() {
			return librarySaves.retryFailed();
		},
		setRating(bookId: string, value: RatingValue, bookUlid?: string, book?: Book) {
			values.update((current) =>
				current.has(bookId)
					? new Map(current).set(bookId, value)
					: new Map([[bookId, value], ...current])
			);
			if (book) details.update((current) => new Map(current).set(bookId, book));
			if (bookUlid) {
				librarySaves.enqueue({ kind: 'rating', bookId, bookUlid, value, book });
				notInterestedStore.remove(bookUlid);
			}
		},
		removeRating(bookId: string, bookUlid?: string) {
			values.update((current) => {
				const next = new Map(current);
				next.delete(bookId);
				return next;
			});
			details.update((current) => {
				const next = new Map(current);
				next.delete(bookId);
				return next;
			});
			if (bookUlid) librarySaves.enqueue({ kind: 'rating', bookId, bookUlid, value: null });
		},
		reset(preservePending = false) {
			if (!preservePending) librarySaves.discard('rating');
			values.set(new Map());
			details.set(new Map());
		}
	};
}
export const ratingsStore = createRatingsStore();
