import { get, writable } from 'svelte/store';
import type { Book } from '$lib/types/book';
import { librarySaves } from './librarySaves';

export interface PlanToReadPersistence {
	add(bookId: string, signal?: AbortSignal): void | Promise<void>;
	remove(bookId: string, signal?: AbortSignal): void | Promise<void>;
}
function createPlanToReadStore() {
	const values = writable<Set<string>>(new Set());
	const details = writable<Map<string, Book>>(new Map());
	let idToUlid = new Map<string, string>();
	function overlay(readRevision: number) {
		const changes = librarySaves.overlays('bookmark', readRevision);
		if (!changes.length) return;
		values.update((current) => {
			const next = new Set(current);
			for (const c of changes) {
				if (!c.bookId) continue;
				idToUlid.set(c.bookId, c.bookUlid);
				if (c.value) next.add(c.bookId);
				else next.delete(c.bookId);
			}
			return next;
		});
		details.update((current) => {
			const next = new Map(current);
			for (const c of changes) if (c.bookId && c.book && c.value) next.set(c.bookId, c.book);
			return next;
		});
	}
	let owner = librarySaves.getOwner();
	let appliedRevision = -1;
	librarySaves.subscribe((snapshot) => {
		if (snapshot.ownerId !== owner) {
			owner = snapshot.ownerId;
			appliedRevision = -1;
			idToUlid = new Map();
			values.set(new Set());
			details.set(new Map());
		}
		overlay(appliedRevision);
		appliedRevision = librarySaves.getRevision();
	});
	return {
		subscribe: values.subscribe,
		bookDetails: { subscribe: details.subscribe },
		has(bookId: string) {
			return get(values).has(bookId);
		},
		getBook(bookId: string) {
			return get(details).get(bookId);
		},
		setPersistence(p: PlanToReadPersistence | null, userId?: string) {
			librarySaves.setWriter(
				'bookmark',
				p
					? (c, signal) => (c.value ? p.add(c.bookUlid, signal) : p.remove(c.bookUlid, signal))
					: null,
				userId
			);
		},
		hydrate(
			bookIds: string[],
			mapping?: Map<string, string>,
			readRevision = librarySaves.getRevision()
		) {
			if (mapping) idToUlid = new Map(mapping);
			values.set(new Set(bookIds));
			overlay(readRevision);
		},
		mergeBooks(books: Book[], readRevision = -1): Book[] {
			const next = new Map(books.map((book) => [book.id, book]));
			for (const c of librarySaves.overlays('bookmark', readRevision)) {
				if (!c.bookId) continue;
				if (!c.value) next.delete(c.bookId);
				else if (c.book && !next.has(c.bookId)) next.set(c.bookId, c.book);
			}
			return [...next.values()];
		},
		toggle(bookId: string, bookUlid?: string, book?: Book) {
			const ulid = bookUlid ?? idToUlid.get(bookId);
			const value = !get(values).has(bookId);
			values.update((current) => {
				const next = new Set(current);
				if (value) next.add(bookId);
				else next.delete(bookId);
				return next;
			});
			if (ulid) {
				idToUlid.set(bookId, ulid);
				librarySaves.enqueue({
					kind: 'bookmark',
					bookId,
					bookUlid: ulid,
					value,
					book: book ?? get(details).get(bookId)
				});
			}
		},
		reset(preservePending = false) {
			if (!preservePending) librarySaves.discard('bookmark');
			values.set(new Set());
			details.set(new Map());
			idToUlid = new Map();
		},
		flushPending() {
			return librarySaves.flush('bookmark');
		}
	};
}
export const planToReadStore = createPlanToReadStore();
