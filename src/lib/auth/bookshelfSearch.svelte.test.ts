import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { page as appPage } from '$app/stores';
import type { Writable } from 'svelte/store';
import type { Session } from '@supabase/supabase-js';
import Bookshelf from '../../routes/my-bookshelf/+page.svelte';
import { authStore, markAuthInitReady } from '$lib/stores/auth';
import { libraryLoads, LIBRARY_COLLECTIONS } from '$lib/stores/libraryLoads';
import { librarySaves } from '$lib/stores/librarySaves';
import { bookmarksPageStore } from '$lib/stores/bookmarksPage';
import { notInterestedStore } from '$lib/stores/notInterested';
import { notInterestedPageLoader } from '$lib/notInterested/pageLoader';
import { ratingsStore } from '$lib/stores/ratings';
import { planToReadStore } from '$lib/stores/planToRead';
import { ratedSummarySheetKeepAlive } from '$lib/stores/ratedSummarySheetKeepAlive';

vi.mock('$app/stores', async () => ({
	page: (await import('svelte/store')).writable({
		url: new URL('http://localhost/my-bookshelf?filter=not-interested'),
		state: {}
	})
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn(),
	preloadData: vi.fn().mockResolvedValue({ status: 200 })
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const owner = 'shelf-search-reader';
const books = Array.from({ length: 120 }, (_, i) => ({
	id: `uuid-${i}`,
	book_id: `ulid-${i}`,
	title: i === 110 ? 'Hidden Nebula' : `Book ${i}`,
	author: i === 110 ? 'Needle Writer' : 'Test Author',
	year: String(1900 + i)
}));
let unmount: (() => void) | undefined;
const pageStore = appPage as unknown as Writable<{ url: URL; state: App.PageState }>;

beforeEach(() => {
	pageStore.set({ url: new URL('http://localhost/my-bookshelf?filter=not-interested'), state: {} });
	localStorage.removeItem('book-doctor:my-bookshelf-sort');
	localStorage.removeItem('book-doctor:my-bookshelf-not-interested-sort');
	librarySaves.activateOwner(owner);
	librarySaves.discard();
	libraryLoads.reset();
	ratingsStore.reset();
	planToReadStore.reset();
	notInterestedStore.reset();
	authStore.setSession({ user: { id: owner }, access_token: 'test-token' } as Session);
	markAuthInitReady();
	notInterestedStore.hydrate(books.map((book) => book.book_id));
	notInterestedPageLoader.reset();
	libraryLoads.markSnapshot(owner, LIBRARY_COLLECTIONS);
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
	notInterestedPageLoader.reset();
	bookmarksPageStore.reset();
	libraryLoads.reset();
	authStore.setSession(null);
	librarySaves.discard();
	ratedSummarySheetKeepAlive.set(null);
	vi.unstubAllGlobals();
	localStorage.removeItem('book-doctor:my-bookshelf-sort');
	localStorage.removeItem('book-doctor:my-bookshelf-not-interested-sort');
});

function fixture(
	beforePage?: (offset: number) => Promise<Response | undefined>,
	bookmarkBooks: typeof books = []
) {
	const reads: URL[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input), location.href);
			if (url.pathname !== '/api/not-interested/books')
				return Response.json({ books: bookmarkBooks });
			reads.push(url);
			const offset = Number(url.searchParams.get('cursor') ?? 0);
			const response = await beforePage?.(offset);
			if (response) return response;
			const ordered = url.searchParams.get('order') === 'oldest' ? [...books].reverse() : books;
			return Response.json({
				books: ordered.slice(offset, offset + 50),
				nextCursor: offset + 50 < books.length ? String(offset + 50) : null
			});
		})
	);
	const view = render(Bookshelf);
	unmount = view.unmount;
	return { view, reads };
}

const displayed = () =>
	[...document.querySelectorAll('.bookshelf-page__list article')].map(
		(el) => (el as HTMLElement).dataset.bookId
	);
async function chooseSort(label: string) {
	await page.getByRole('button', { name: 'Sort books on your shelf' }).click();
	await expect
		.poll(() =>
			[...document.querySelectorAll('[role="option"]')].map((el) => el.textContent?.trim())
		)
		.toEqual([
			'Recently added',
			'First added',
			'Newest first',
			'Oldest first',
			'Highest rating',
			'Lowest rating'
		]);
	await page.getByRole('option', { name: label, exact: true }).click();
}

it('searches later dismissal pages, sorts all years, and keeps the separate sort preference and hidden count', async () => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const { view, reads } = fixture(async (offset) => {
		if (offset === 50) await pending;
		return undefined;
	});
	await expect.poll(() => displayed().length).toBe(50);
	expect(reads).toHaveLength(1);
	await expect
		.element(view.getByRole('tab', { name: 'Not interested', exact: true }))
		.toBeVisible();
	const search = view.getByRole('searchbox');
	await search.fill('nebla needle writre');
	await expect.poll(() => reads.length).toBe(2);
	expect(document.body.textContent).not.toContain(
		'No books marked as not interested match your search.'
	);
	release();
	await expect.poll(displayed).toEqual(['uuid-110']);
	expect(reads).toHaveLength(3);
	await search.fill('');
	await expect.poll(() => displayed().length).toBe(120);
	await chooseSort('Newest first');
	await expect.poll(displayed).toEqual([...books].reverse().map((book) => book.id));
	await chooseSort('Oldest first');
	await expect.poll(displayed).toEqual(books.map((book) => book.id));
	await view.getByRole('tab', { name: /^Rated/ }).click();
	await expect
		.element(view.getByRole('button', { name: 'Sort books on your shelf' }))
		.toHaveTextContent('Recently added');
	await chooseSort('First added');
	await view.getByRole('tab', { name: 'Not interested', exact: true }).click();
	await expect
		.element(view.getByRole('button', { name: 'Sort books on your shelf' }))
		.toHaveTextContent('Oldest first');
	expect(localStorage.getItem('book-doctor:my-bookshelf-sort')).toBe('oldest');
	expect(localStorage.getItem('book-doctor:my-bookshelf-not-interested-sort')).toBe('year-oldest');
});

it('shows a retry error instead of a false no-match state and resumes loading all pages after retry', async () => {
	let fail = true;
	fixture(async (offset) => {
		if (offset === 50 && fail) {
			fail = false;
			return Response.json({}, { status: 403 });
		}
		return undefined;
	});
	await expect.poll(() => displayed().length).toBe(50);
	await page.getByRole('searchbox').fill('Hidden Nebula');
	await expect.element(page.getByRole('alert')).toBeVisible();
	expect(document.body.textContent).not.toContain(
		'No books marked as not interested match your search.'
	);
	await page.getByRole('button', { name: 'Try again', exact: true }).click();
	await expect.poll(displayed).toEqual(['uuid-110']);
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
});

function ratedShelf() {
	notInterestedStore.reset();
	ratingsStore.hydrate(books.map((book) => ({ bookId: book.id, rating: 4 })));
	ratingsStore.setRatedBooksDetails(new Map(books.map((book) => [book.id, book])));
	pageStore.set({ url: new URL('http://localhost/my-bookshelf?filter=rated'), state: {} });
}

it.each(['rated', 'bookmarked'] as const)(
	'mounts %s cards in batches while searching and sorting the complete shelf',
	async (filter) => {
		ratedShelf();
		if (filter === 'bookmarked') {
			planToReadStore.hydrate(books.map((book) => book.id));
			pageStore.set({ url: new URL('http://localhost/my-bookshelf?filter=bookmarked'), state: {} });
		}
		let nearViewport = () => {};
		const disconnect = vi.fn();
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				constructor(callback: IntersectionObserverCallback) {
					nearViewport = () =>
						callback(
							[{ isIntersecting: true }] as IntersectionObserverEntry[],
							this as unknown as IntersectionObserver
						);
				}
				observe() {}
				unobserve() {}
				disconnect = disconnect;
			}
		);
		const { view } = fixture(undefined, books);
		await expect.poll(() => displayed().length).toBe(24);
		await expect
			.element(
				view.getByRole('tab', {
					name: `${filter === 'rated' ? 'Rated' : 'Bookmarked'}, 120`,
					exact: true
				})
			)
			.toBeVisible();
		nearViewport();
		await expect.poll(() => displayed().length).toBe(48);
		await view.getByRole('searchbox').fill('Hidden Nebula');
		await expect.poll(displayed).toEqual(['uuid-110']);
		await view.getByRole('searchbox').fill('');
		await expect.poll(() => displayed().length).toBe(48);
		await chooseSort('Newest first');
		await expect.poll(displayed).toEqual(
			[...books]
				.reverse()
				.slice(0, 24)
				.map((book) => book.id)
		);
		await view.getByRole('button', { name: 'Show more books', exact: true }).click();
		await expect.poll(() => displayed().length).toBe(48);
		expect(disconnect).toHaveBeenCalled();
	}
);

it('keeps an open summary mounted when its removed rating moves beyond the rendered batch', async () => {
	ratedShelf();
	const { view } = fixture();
	await expect.poll(() => displayed().length).toBe(24);
	const book = books[0];
	await view
		.getByRole('button', {
			name: `${book.title} by ${book.author}. See summary`,
			exact: true
		})
		.first()
		.click();
	await expect.element(page.getByRole('dialog')).toBeVisible();
	ratingsStore.removeRating(book.id, book.book_id);
	await expect.poll(() => displayed().includes(book.id)).toBe(true);
	await expect.element(page.getByRole('dialog')).toBeVisible();
});
