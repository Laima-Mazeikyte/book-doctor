import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Session } from '@supabase/supabase-js';
import type { BookDiscoveryResult, DiscoveryBook } from '$lib/books/discovery';
import { authStore, authInitStore, markAuthInitReady } from '$lib/stores/auth';
import { ratingsStore } from '$lib/stores/ratings';
import { librarySaves } from '$lib/stores/librarySaves';
import { libraryLoads } from '$lib/stores/libraryLoads';
import { clearUserLibraryHydration } from '$lib/stores/userLibrary';
import BookDiscovery from './BookDiscovery.svelte';

const api = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('$lib/books/discovery', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/books/discovery')>()),
	loadBookDiscovery: api.load
}));
vi.mock('$lib/supabase', () => ({ getSupabase: () => ({}) }));
vi.mock('$lib/book-cover', () => ({
	coverUrlForBookId: (id: string) => `https://covers.example/${id}-720.avif`,
	coverUrlForBookIdAtSize: (id: string, size: number) => `https://covers.example/${id}-${size}.avif`
}));
const id = (n: number) => `01${String(n).padStart(24, '0')}`;
const item = (n: number): DiscoveryBook => ({
	book_id: id(n),
	slug: `book-${n}`,
	title: `Book ${n}`,
	author: `Author ${n}`,
	reason: { code: 'shared_profile', params: {} }
});
const data: BookDiscoveryResult = {
	bookId: id(1),
	releaseId: 'release',
	similarExperience: [2, 3, 4, 5, 6].map(item),
	differentDirection: [
		{ ...item(7), reason: { code: 'dimension_contrast', params: { axis: 'pace', direction: -1 } } }
	]
};
function session(owner = 'reader', token = 'token') {
	authStore.setSession({ user: { id: owner }, access_token: token } as Session);
}
function pending() {
	let finish!: (data: BookDiscoveryResult) => void;
	const promise = new Promise<BookDiscoveryResult>((resolve) => {
		finish = resolve;
	});
	return { promise, finish };
}
beforeEach(() => {
	api.load.mockReset().mockResolvedValue(data);
	authStore.setSession(null);
	markAuthInitReady();
	librarySaves.discard();
	librarySaves.activateOwner(null);
	clearUserLibraryHydration();
	ratingsStore.reset();
});

it('works signed out after auth restoration and the main cover gate', async () => {
	authInitStore.set({ status: 'checking' });
	const screen = render(BookDiscovery, { bookId: id(1), imagesReady: false });
	await tick();
	expect(api.load).not.toHaveBeenCalled();
	markAuthInitReady();
	await tick();
	expect(api.load).not.toHaveBeenCalled();
	await screen.rerender({ imagesReady: true });
	await expect.element(screen.getByRole('heading', { name: 'Similar experience' })).toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: /Book 2 / }))
		.toHaveAttribute('href', '/books/book-2');
	await expect.element(screen.getByText('More action-driven')).toBeVisible();
	expect(document.querySelectorAll('.discovery-books a')).toHaveLength(4);
	expect(api.load).toHaveBeenCalledTimes(1);
	const image = document.querySelector('.discovery-books img')!;
	expect(image.getAttribute('src')).toBe(`https://covers.example/${id(2)}-200.avif`);
	expect(image.getAttribute('loading')).toBe('lazy');
	expect(image.getAttribute('fetchpriority')).toBe('low');
	expect(image.getAttribute('decoding')).toBe('async');
	expect(image.getAttribute('width')).toBe('200');
	expect(image.getAttribute('height')).toBe('300');
	image.dispatchEvent(new Event('error'));
	expect((image as HTMLImageElement).style.visibility).toBe('hidden');
	expect(document.querySelector('.mini-cover svg')).not.toBeNull();
	screen.unmount();
});

it('prioritizes unread books without fetching metadata and never refetches for library or token changes', async () => {
	session();
	librarySaves.activateOwner('reader');
	const screen = render(BookDiscovery, { bookId: id(1), imagesReady: true });
	await expect.element(screen.getByRole('link', { name: /Book 2 / })).toBeVisible();
	ratingsStore.hydrate(
		[
			{ bookId: 'uuid-2', rating: 1 },
			{ bookId: 'uuid-4', rating: 5 }
		],
		undefined,
		new Map([
			['uuid-2', id(2)],
			['uuid-4', id(4)]
		])
	);
	libraryLoads.markSnapshot('reader', ['ratings']);
	await tick();
	expect(
		[...document.querySelectorAll('section:first-child a')].map((a) => a.getAttribute('href'))
	).toEqual(['/books/book-3', '/books/book-5', '/books/book-6']);
	session('reader', 'refreshed');
	await tick();
	expect(api.load).toHaveBeenCalledTimes(1);
	// A different account cannot inherit the former reader's filtering, even
	// before the layout has replaced the library stores.
	session('another-reader');
	await tick();
	await expect.element(screen.getByRole('link', { name: /Book 2 / })).toBeVisible();
	authStore.setSession(null);
	await tick();
	await expect.element(screen.getByRole('link', { name: /Book 2 / })).toBeVisible();
	expect(api.load).toHaveBeenCalledTimes(1);
	screen.unmount();
});

it('shows two unread books and one familiar book without a read-status label or extra request', async () => {
	session();
	librarySaves.activateOwner('reader');
	ratingsStore.hydrate(
		[2, 3, 4].map((n) => ({ bookId: `uuid-${n}`, rating: 5 as const })),
		undefined,
		new Map([2, 3, 4].map((n) => [`uuid-${n}`, id(n)]))
	);
	libraryLoads.markSnapshot('reader', ['ratings']);
	const screen = render(BookDiscovery, { bookId: id(1), imagesReady: true });
	await expect.element(screen.getByRole('heading', { name: 'Similar experience' })).toBeVisible();
	expect(
		[...document.querySelectorAll('section:first-child a')].map((a) => a.getAttribute('href'))
	).toEqual(['/books/book-5', '/books/book-6', '/books/book-2']);
	expect(document.querySelector('.discovery-sections')?.textContent).not.toMatch(
		/already read|previously read|you.ve read|your rating/i
	);
	expect(api.load).toHaveBeenCalledTimes(1);
	screen.unmount();
});

it('aborts navigation and unmount requests, ignores late data and refetches on Back', async () => {
	const first = pending();
	api.load
		.mockReturnValueOnce(first.promise)
		.mockResolvedValueOnce({
			...data,
			bookId: id(9),
			similarExperience: [],
			differentDirection: []
		})
		.mockResolvedValueOnce(data);
	const screen = render(BookDiscovery, { bookId: id(1), imagesReady: true });
	await tick();
	const signal = api.load.mock.calls[0][2] as AbortSignal;
	await screen.rerender({ bookId: id(9), imagesReady: false });
	expect(signal.aborted).toBe(true);
	first.finish(data);
	await tick();
	expect(document.querySelector('.discovery-books')).toBeNull();
	await screen.rerender({ imagesReady: true });
	await vi.waitFor(() => expect(api.load).toHaveBeenCalledTimes(2));
	await screen.rerender({ bookId: id(1) });
	await expect.element(screen.getByRole('link', { name: /Book 2 / })).toBeVisible();
	expect(api.load.mock.calls.map((call) => call[1])).toEqual([id(1), id(9), id(1)]);
	const last = api.load.mock.calls[2][2] as AbortSignal;
	screen.unmount();
	expect(last.aborted).toBe(true);
});

it('omits empty sections, retains a populated section and offers explicit retry for failures', async () => {
	api.load
		.mockRejectedValueOnce(new Error('Unavailable'))
		.mockResolvedValueOnce({ ...data, similarExperience: [] });
	const screen = render(BookDiscovery, { bookId: id(1), imagesReady: true });
	await expect
		.element(screen.getByText('Related books are temporarily unavailable.'))
		.toBeVisible();
	await screen.getByRole('button', { name: 'Try again' }).click();
	await expect
		.element(screen.getByRole('heading', { name: 'A different direction' }))
		.toBeVisible();
	expect(document.querySelector('#similar-title')).toBeNull();
	expect(api.load).toHaveBeenCalledTimes(2);
	screen.unmount();
	api.load.mockResolvedValue({ ...data, similarExperience: [], differentDirection: [] });
	const empty = render(BookDiscovery, { bookId: id(1), imagesReady: true });
	await vi.waitFor(() => expect(api.load).toHaveBeenCalledTimes(3));
	await tick();
	expect(document.querySelector('.discovery-sections')).toBeNull();
	empty.unmount();
});
