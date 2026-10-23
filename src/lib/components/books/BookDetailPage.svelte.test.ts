import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import type { Session } from '@supabase/supabase-js';
import type { Book } from '$lib/types/book';
import { authStore, markAuthInitReady } from '$lib/stores/auth';
import { clearUserLibraryHydration, markUserLibraryIdsReady } from '$lib/stores/userLibrary';
import { ratingsStore } from '$lib/stores/ratings';
import { planToReadStore } from '$lib/stores/planToRead';
import { notInterestedStore } from '$lib/stores/notInterested';
import { bookCharacteristics } from '$lib/books/characteristics';
import BookDetailPage from './BookDetailPage.svelte';

vi.mock('$lib/auth/anonymous-session', () => ({
	ensureAnonymousSessionStarted: vi.fn().mockResolvedValue(true)
}));
const book: Book = {
	id: 'uuid-book',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	title: 'The Test Book',
	author: 'An Author',
	year: '2020',
	summary: 'A real catalog synopsis.',
	qualityBand: 'top_1_percent'
};
const other: Book = {
	...book,
	id: 'uuid-other',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXC',
	title: 'Another Book'
};
const props = {
	book,
	authorBooks: [other],
	authorBooksUnavailable: false,
	authorBooksTruncated: false,
	canonicalUrl: `https://unread.example/books/${book.book_id}/the-test-book`,
	characteristics: bookCharacteristics({ pace_value: 0.8, violence_value: 0.8 })
};

beforeEach(() => {
	authStore.setSession(null);
	markAuthInitReady();
	clearUserLibraryHydration();
	ratingsStore.reset();
	planToReadStore.reset();
	notInterestedStore.reset();
});
afterEach(() => {
	vi.unstubAllGlobals();
});

it('renders real catalog evidence, expands author books, and keeps missing features explicit', async () => {
	const screen = render(BookDetailPage, props);
	await expect.element(screen.getByRole('heading', { name: book.title })).toBeVisible();
	await expect.element(screen.getByText('Top 1% overall', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Unhurried', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Graphic', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Match score coming soon')).toBeVisible();
	await expect
		.element(screen.getByText('Rate at least 10 books to build your reading profile.'))
		.toBeVisible();
	await expect
		.element(screen.getByText('Similar-experience recommendations coming soon'))
		.toBeVisible();
	await screen.getByRole('button', { name: book.author, exact: true }).click();
	await expect
		.element(screen.getByRole('link', { name: /Another Book/ }))
		.toHaveAttribute('href', `/books/${other.book_id}/another-book`);
	screen.unmount();
});

it('connects save, rating, and not-interested actions through the existing library stores', async () => {
	const screen = render(BookDetailPage, props);
	await screen.getByRole('button', { name: 'Save book', exact: true }).click();
	expect(planToReadStore.has(book.id)).toBe(true);
	await screen.getByRole('button', { name: 'Rate 5 of 5 stars' }).click();
	expect(get(ratingsStore).get(book.id)).toBe(5);
	await screen.getByRole('button', { name: 'Not interested', exact: true }).click();
	expect(notInterestedStore.has(book.book_id)).toBe(true);
	expect(planToReadStore.has(book.id)).toBe(false);
	expect(get(ratingsStore).has(book.id)).toBe(false);
	await screen.getByRole('button', { name: 'Rate 4 of 5 stars' }).click();
	expect(notInterestedStore.has(book.book_id)).toBe(false);
	screen.unmount();
});

it('shows only still-liked reference books from the current account’s recommendation evidence', async () => {
	const disliked = {
		...other,
		id: 'uuid-disliked',
		book_id: '01KR2ADTNG29NSQV23VAGV8FXD',
		title: 'A Disliked Book'
	};
	vi.stubGlobal(
		'fetch',
		vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				Response.json({ likedBookPrecedentsByBookId: { [book.book_id]: [other, disliked] } })
			)
	);
	ratingsStore.hydrate(
		Array.from({ length: 10 }, (_, i) => ({
			bookId: i === 0 ? other.id : i === 1 ? disliked.id : `rated-${i}`,
			rating: i === 1 ? 2 : 5
		}))
	);
	authStore.setSession({ access_token: 'private-token', user: { id: 'reader' } } as Session);
	markUserLibraryIdsReady('reader');
	const screen = render(BookDetailPage, { ...props, authorBooks: [] });
	await expect.element(screen.getByRole('link', { name: /Another Book/ })).toBeVisible();
	expect(document.querySelector('.reference-books')?.textContent).not.toContain('A Disliked Book');
	authStore.setSession(null);
	await expect.element(screen.getByText('Book connections coming soon')).toBeVisible();
	expect(document.querySelector('.reference-books')).toBeNull();
	screen.unmount();
});

it('ignores a private response that arrives after sign-out', async () => {
	let finish: ((response: Response) => void) | undefined;
	const fetchMock = vi.fn<typeof fetch>(
		() =>
			new Promise<Response>((resolve) => {
				finish = resolve;
			})
	);
	vi.stubGlobal('fetch', fetchMock);
	ratingsStore.hydrate(
		Array.from({ length: 10 }, (_, i) => ({ bookId: i === 0 ? other.id : `rated-${i}`, rating: 5 }))
	);
	authStore.setSession({ access_token: 'private-token', user: { id: 'reader' } } as Session);
	markUserLibraryIdsReady('reader');
	const screen = render(BookDetailPage, props);
	await tick();
	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
		headers: { Authorization: 'Bearer private-token' }
	});
	authStore.setSession(null);
	await tick();
	finish?.(Response.json({ likedBookPrecedentsByBookId: { [book.book_id]: [other] } }));
	await tick();
	await expect.element(screen.getByText('Book connections coming soon')).toBeVisible();
	expect(document.querySelector('.reference-books')).toBeNull();
	screen.unmount();
});
