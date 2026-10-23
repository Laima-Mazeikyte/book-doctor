import { get, writable } from 'svelte/store';
import type { Book } from '$lib/types/book';
import { librarySaves } from './librarySaves';

export interface NotInterestedPersistence {
	add(bookId: string, signal?: AbortSignal): void | Promise<void>;
	remove(bookId: string, signal?: AbortSignal): void | Promise<void>;
}
export interface NotInterestedChange {
	bookId: string;
	action: 'add' | 'remove';
	source: 'mutation' | 'hydrate';
}
function createNotInterestedStore() {
	const values = writable<Set<string>>(new Set());
	const listeners = new Set<(change: NotInterestedChange) => void>();
	function publish(next: Set<string>, source: NotInterestedChange['source']) {
		const previous = get(values);
		values.set(next);
		for (const bookId of previous)
			if (!next.has(bookId))
				for (const listener of listeners) listener({ bookId, action: 'remove', source });
		for (const bookId of next)
			if (!previous.has(bookId))
				for (const listener of listeners) listener({ bookId, action: 'add', source });
	}
	function overlay(base: Set<string>, readRevision: number) {
		const next = new Set(base);
		for (const c of librarySaves.overlays('dismissal', readRevision)) {
			if (c.value) next.add(c.bookUlid);
			else next.delete(c.bookUlid);
		}
		return next;
	}
	function change(bookUlid: string, value: boolean, book?: Book) {
		const current = get(values);
		if (current.has(bookUlid) === value) return;
		const next = new Set(current);
		if (value) next.add(bookUlid);
		else next.delete(bookUlid);
		publish(next, 'mutation');
		librarySaves.enqueue({ kind: 'dismissal', bookUlid, bookId: book?.id, book, value });
	}
	let owner = librarySaves.getOwner();
	let appliedRevision = -1;
	librarySaves.subscribe((snapshot) => {
		if (snapshot.ownerId !== owner) {
			owner = snapshot.ownerId;
			appliedRevision = -1;
			values.set(new Set());
		}
		const next = overlay(get(values), appliedRevision);
		const previous = get(values);
		if (next.size !== previous.size || [...next].some((id) => !previous.has(id)))
			publish(next, 'hydrate');
		appliedRevision = librarySaves.getRevision();
	});
	return {
		subscribe: values.subscribe,
		has(bookId: string) {
			return get(values).has(bookId);
		},
		getBookIds() {
			return [...get(values)];
		},
		setPersistence(p: NotInterestedPersistence | null, userId?: string) {
			librarySaves.setWriter(
				'dismissal',
				p
					? (c, signal) => (c.value ? p.add(c.bookUlid, signal) : p.remove(c.bookUlid, signal))
					: null,
				userId
			);
		},
		onChange(listener: (change: NotInterestedChange) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		hydrate(bookIds: string[], readRevision = librarySaves.getRevision()) {
			publish(overlay(new Set(bookIds), readRevision), 'hydrate');
		},
		toggle(bookId: string, book?: Book) {
			const next = !get(values).has(bookId);
			change(bookId, next, book);
			return next;
		},
		add(bookId: string, book?: Book) {
			change(bookId, true, book);
		},
		remove(bookId: string) {
			change(bookId, false);
		},
		reset(preservePending = false) {
			if (!preservePending) librarySaves.discard('dismissal');
			values.set(new Set());
		},
		flushPending() {
			return librarySaves.flush('dismissal');
		}
	};
}
export const notInterestedStore = createNotInterestedStore();
