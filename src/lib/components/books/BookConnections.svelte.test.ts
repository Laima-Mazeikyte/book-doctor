import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Session } from '@supabase/supabase-js';
import type { BookConnection } from '$lib/books/connections';
import { authStore, authInitStore, markAuthInitReady } from '$lib/stores/auth';
import { ratingsStore } from '$lib/stores/ratings';
import BookConnections from './BookConnections.svelte';

const api = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('$lib/books/connections', () => ({ loadBookConnections: api.load }));
vi.mock('$lib/supabase', () => ({ getSupabase: () => ({}) }));
vi.mock('$lib/book-cover', () => ({
	coverUrlForBookId: (id: string) => `https://covers.example/${id}-720.avif`,
	coverUrlForBookIdAtSize: (id: string, size: number) => `https://covers.example/${id}-${size}.avif`
}));
const id = (n: number) => `01${String(n).padStart(24, '0')}`;
const match: BookConnection = {
	book: {
		id: 'uuid-familiar',
		book_id: id(2),
		slug: 'familiar-book',
		title: 'Familiar Book',
		author: 'An Author'
	},
	rating: 2
};
function session(user = 'reader', token = 'token') {
	authStore.setSession({ user: { id: user }, access_token: token } as Session);
}
function pending() {
	let finish!: (value: BookConnection[]) => void;
	const promise = new Promise<BookConnection[]>((resolve) => {
		finish = resolve;
	});
	return { promise, finish };
}
beforeEach(() => {
	api.load.mockReset().mockResolvedValue([match]);
	authStore.setSession(null);
	markAuthInitReady();
	ratingsStore.reset();
});

it('waits for authentication and the main cover, without waiting for library hydration', async () => {
	authInitStore.set({ status: 'checking' });
	const screen = render(BookConnections, { bookId: id(1), imagesReady: false });
	session();
	await tick();
	expect(api.load).not.toHaveBeenCalled();
	markAuthInitReady();
	await tick();
	expect(api.load).not.toHaveBeenCalled();
	await screen.rerender({ imagesReady: true });
	await expect.element(screen.getByRole('link', { name: /Familiar Book/ })).toBeVisible();
	expect(api.load).toHaveBeenCalledTimes(1);
	screen.unmount();
});

it('keeps the visit snapshot through rating edits, metadata hydration and token refresh', async () => {
	session();
	const screen = render(BookConnections, { bookId: id(1), imagesReady: true });
	await expect.element(screen.getByText('Your rating: 2 / 5')).toBeVisible();
	ratingsStore.hydrate([{ bookId: match.book.id, rating: 5 }]);
	ratingsStore.setRatedBooksDetails(new Map([[match.book.id, match.book]]));
	await tick();
	ratingsStore.hydrate([]);
	session('reader', 'refreshed-token');
	await tick();
	expect(api.load).toHaveBeenCalledTimes(1);
	await expect.element(screen.getByText('Your rating: 2 / 5')).toBeVisible();
	const image = document.querySelector('img')!;
	expect(image.getAttribute('src')).toBe(`https://covers.example/${match.book.book_id}-200.avif`);
	expect(image.getAttribute('fetchpriority')).toBe('low');
	expect(image.getAttribute('width')).toBe('200');
	expect(image.getAttribute('height')).toBe('300');
	expect(document.querySelector('a')?.getAttribute('href')).toBe('/books/familiar-book');
	screen.unmount();
});

it('aborts old navigation and loads again for every book visit, including Back', async () => {
	session();
	const first = pending();
	api.load
		.mockReturnValueOnce(first.promise)
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([match]);
	const screen = render(BookConnections, { bookId: id(1), imagesReady: true });
	await tick();
	const signal: AbortSignal = api.load.mock.calls[0][2];
	await screen.rerender({ bookId: id(3), imagesReady: false });
	expect(signal.aborted).toBe(true);
	first.finish([match]);
	await tick();
	expect(document.querySelector('.reference-books')).toBeNull();
	await screen.rerender({ imagesReady: true });
	await vi.waitFor(() => expect(api.load).toHaveBeenCalledTimes(2));
	await screen.rerender({ bookId: id(1) });
	await expect.element(screen.getByRole('link', { name: /Familiar Book/ })).toBeVisible();
	expect(api.load.mock.calls.map((call) => call[1])).toEqual([id(1), id(3), id(1)]);
	screen.unmount();
});

it('clears the previous account immediately and ignores late account and sign-out responses', async () => {
	session();
	const next = pending();
	const screen = render(BookConnections, { bookId: id(1), imagesReady: true });
	await expect.element(screen.getByRole('link', { name: /Familiar Book/ })).toBeVisible();
	api.load.mockReturnValueOnce(next.promise);
	session('another-reader');
	await tick();
	expect(document.querySelector('.reference-books')).toBeNull();
	expect((api.load.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
	authStore.setSession(null);
	await tick();
	expect((api.load.mock.calls[1][2] as AbortSignal).aborted).toBe(true);
	next.finish([match]);
	await tick();
	expect(document.querySelector('.book-connections')).toBeNull();
	session('another-reader');
	await expect.element(screen.getByRole('link', { name: /Familiar Book/ })).toBeVisible();
	expect(api.load).toHaveBeenCalledTimes(3);
	screen.unmount();
});

it('omits successful empty results and keeps failures distinct without automatic retry', async () => {
	session();
	api.load.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('RPC unavailable'));
	const screen = render(BookConnections, { bookId: id(1), imagesReady: true });
	await tick();
	expect(document.querySelector('.book-connections')).toBeNull();
	await screen.rerender({ bookId: id(3) });
	await expect
		.element(screen.getByText('Book connections are temporarily unavailable.'))
		.toBeVisible();
	session('reader', 'refreshed');
	await tick();
	expect(api.load).toHaveBeenCalledTimes(2);
	screen.unmount();
});
