import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import type { Session } from '@supabase/supabase-js';
import type { Book } from '$lib/types/book';
import { authStore, markAuthInitReady } from '$lib/stores/auth';
import { clearUserLibraryHydration } from '$lib/stores/userLibrary';
import { libraryLoads, type LibraryCollection } from '$lib/stores/libraryLoads';
import { librarySaves } from '$lib/stores/librarySaves';
import { ratingsStore } from '$lib/stores/ratings';
import { planToReadStore } from '$lib/stores/planToRead';
import { notInterestedStore } from '$lib/stores/notInterested';
import { bookCharacteristics } from '$lib/books/characteristics';
import { valuesFromBook } from '$lib/corrections/model';
import BookDetailPage from './BookDetailPage.svelte';

vi.mock('$lib/auth/anonymous-session', () => ({
	ensureAnonymousSessionStarted: vi.fn().mockResolvedValue(true)
}));
const corrections = vi.hoisted(() => ({ load: vi.fn() }));
const connections = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('$lib/books/connections', () => ({ loadBookConnections: connections.load }));
vi.mock('$lib/supabase', () => ({ getSupabase: () => ({}) }));
vi.mock('$lib/corrections/api', () => ({
	loadCorrectionContext: corrections.load,
	saveCorrection: vi.fn(),
	withdrawCorrection: vi.fn()
}));
const book: Book = {
	id: 'uuid-book',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	slug: 'the-test-book-an-author',
	title: 'The Test Book',
	author: 'An Author',
	year: '2020',
	summary: 'A real catalog synopsis.',
	qualityBand: 'top_1_percent',
	characteristics: bookCharacteristics({
		pace_value: 0.8,
		violence_value: 0.8,
		atmosphere_value: 0.2,
		entry_barrier_value: 0.8
	}).labels,
	distinctions: {
		book: { percent: 1, subject: 'book', rank: 10, populationCount: 1000, version: 'books-v1' },
		author: {
			percent: 5,
			subject: 'author',
			rank: 50,
			populationCount: 1000,
			version: 'authors-v1'
		}
	}
};
const other: Book = {
	...book,
	id: 'uuid-other',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXC',
	slug: 'another-book-an-author',
	title: 'Another Book'
};
const props = {
	book,
	canonicalUrl: `https://unread.example/books/${book.slug}`
};

beforeEach(() => {
	connections.load.mockReset().mockResolvedValue([]);
	authStore.setSession(null);
	librarySaves.discard();
	librarySaves.activateOwner(null);
	markAuthInitReady();
	clearUserLibraryHydration();
	ratingsStore.reset();
	planToReadStore.reset();
	notInterestedStore.reset();
	corrections.load.mockReset().mockResolvedValue({
		catalog: valuesFromBook(book),
		pending: [],
		remaining: 20,
		resetsAt: null
	});
});
afterEach(() => {
	vi.unstubAllGlobals();
});

it('renders real catalog evidence, expands author books, and keeps missing features explicit', async () => {
	const fetchMock = vi.fn().mockResolvedValue(Response.json({ books: [other], truncated: false }));
	vi.stubGlobal('fetch', fetchMock);
	const screen = render(BookDetailPage, props);
	await expect.element(screen.getByRole('heading', { name: book.title })).toBeVisible();
	await expect.element(screen.getByText('Top 1% book', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Top 5% Author', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Introspective', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Cozy', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Specialized', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Graphic', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Match score coming soon')).toBeVisible();
	await expect
		.element(screen.getByText('Rate at least 10 books to build your reading profile.'))
		.toBeVisible();
	await expect
		.element(screen.getByText('Similar-experience recommendations coming soon'))
		.toBeVisible();
	expect(fetchMock).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: book.author, exact: true }).click();
	await expect
		.element(screen.getByRole('link', { name: /Another Book/ }))
		.toHaveAttribute('href', `/books/${other.slug}`);
	await screen.getByRole('button', { name: book.author, exact: true }).click();
	await screen.getByRole('button', { name: book.author, exact: true }).click();
	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(fetchMock.mock.calls[0][0]).toContain('/api/books/by-author?author=An+Author');
	screen.unmount();
});

it('renders stored annotations immediately without a badge request or legacy fallback', async () => {
	const fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
	const screen = render(BookDetailPage, {
		...props,
		book: { ...book, distinctions: { book: null, author: null } }
	});
	await expect.element(screen.getByText('Cozy', { exact: true })).toBeVisible();
	expect(document.querySelector('[data-testid="book-annotations"]')?.textContent).not.toContain(
		'Top '
	);
	expect(fetchMock).not.toHaveBeenCalled();
	screen.unmount();
});

it('changes stored badges synchronously when navigating between books', async () => {
	const screen = render(BookDetailPage, props);
	await expect.element(screen.getByText('Top 1% book', { exact: true })).toBeVisible();
	await screen.rerender({
		book: {
			...other,
			distinctions: {
				book: { percent: 10, subject: 'book', rank: 100, populationCount: 1000, version: 'v1' },
				author: null
			}
		}
	});
	await expect.element(screen.getByText('Top 10% book', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Top 1% book', { exact: true })).not.toBeInTheDocument();
	screen.unmount();
});

it('shows the agreed missing-description copy and awards with initial book metadata', async () => {
	const screen = render(BookDetailPage, {
		...props,
		book: {
			...book,
			summary: undefined,
			awards: [{ tier: 1, name: 'Example Award', status: 'winner', year: null }]
		}
	});
	await expect
		.element(screen.getByText('No description available.', { exact: true }))
		.toBeVisible();
	await expect.element(screen.getByRole('heading', { name: 'Awards', exact: true })).toBeVisible();
	await expect.element(screen.getByText('Winner', { exact: true })).toBeVisible();
	expect(document.querySelector('.book-awards')?.textContent).not.toContain('Awarded to');
	screen.unmount();
});

it('connects save, rating, and not-interested actions through the existing library stores', async () => {
	const screen = render(BookDetailPage, props);
	const cover = document.querySelector('.book-cover')!;
	expect(getComputedStyle(cover).opacity).toBe('1');
	await screen.getByRole('button', { name: 'Save book', exact: true }).click();
	expect(planToReadStore.has(book.id)).toBe(true);
	await screen.getByRole('button', { name: 'Rate 5 of 5 stars' }).click();
	expect(get(ratingsStore).get(book.id)).toBe(5);
	await screen.getByRole('button', { name: 'Not interested', exact: true }).click();
	expect(notInterestedStore.has(book.book_id)).toBe(true);
	expect(getComputedStyle(cover).opacity).toBe('0.3');
	expect(getComputedStyle(document.querySelector('.library-actions')!).opacity).toBe('1');
	expect(planToReadStore.has(book.id)).toBe(false);
	expect(get(ratingsStore).has(book.id)).toBe(false);
	await screen.getByRole('button', { name: 'Rate 4 of 5 stars' }).click();
	expect(notInterestedStore.has(book.book_id)).toBe(false);
	expect(getComputedStyle(cover).opacity).toBe('1');
	screen.unmount();
});

it.each(['ratings', 'bookmarks', 'dismissals'] as const)(
	'keeps independent actions available when %s fails to load',
	async (missing) => {
		authStore.setSession({ access_token: 'private-token', user: { id: 'reader' } } as Session);
		librarySaves.activateOwner('reader');
		const collections: LibraryCollection[] = ['ratings', 'bookmarks', 'dismissals'];
		libraryLoads.markSnapshot(
			'reader',
			collections.filter((kind) => kind !== missing)
		);
		libraryLoads.register(
			'reader',
			missing,
			async () => {
				throw Object.assign(new Error('Unavailable'), { status: 403 });
			},
			1,
			() => true
		);
		await libraryLoads.load(missing);
		expect(get(libraryLoads).collections[missing].status).toBe('error');
		const screen = render(BookDetailPage, props);
		const save = screen.getByRole('button', { name: 'Save book', exact: true });
		const rate = screen.getByRole('button', { name: 'Rate 5 of 5 stars' });
		const dismiss = screen.getByRole('button', { name: 'Not interested', exact: true });
		await expect.element(dismiss).toBeDisabled();
		if (missing === 'ratings') {
			await expect.element(save).toBeEnabled();
			await expect.element(rate).toBeDisabled();
			await save.click();
			expect(planToReadStore.has(book.id)).toBe(true);
		} else if (missing === 'bookmarks') {
			await expect.element(save).toBeDisabled();
			await expect.element(rate).toBeEnabled();
			await rate.click();
			expect(get(ratingsStore).get(book.id)).toBe(5);
			await screen.getByRole('button', { name: 'Remove', exact: true }).click();
			expect(get(ratingsStore).has(book.id)).toBe(false);
		} else {
			await expect.element(save).toBeDisabled();
			await expect.element(rate).toBeDisabled();
		}
		libraryLoads.markSnapshot('reader', [missing]);
		await expect.element(dismiss).toBeEnabled();
		screen.unmount();
	}
);

it('shows the cover immediately, then fades it when saved dismissal state arrives', async () => {
	const screen = render(BookDetailPage, {
		...props,
		book: { ...book, coverUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E' }
	});
	const cover = document.querySelector('.book-cover')!;
	const image = document.querySelector('.book-cover img');
	expect(image).not.toBeNull();
	expect(getComputedStyle(cover).opacity).toBe('1');
	notInterestedStore.hydrate([book.book_id]);
	await tick();
	expect(getComputedStyle(cover).opacity).toBe('0.3');
	expect(document.querySelector('.book-cover img')).toBe(image);
	await screen.getByRole('button', { name: 'Marked not interested', exact: true }).click();
	expect(getComputedStyle(cover).opacity).toBe('1');
	screen.unmount();
});

it('uses known dismissal state on first render, including the cover fallback', async () => {
	notInterestedStore.hydrate([book.book_id]);
	const screen = render(BookDetailPage, props);
	expect(document.querySelector('.cover-fallback')).not.toBeNull();
	expect(getComputedStyle(document.querySelector('.book-cover')!).opacity).toBe('0.3');
	await expect.element(screen.getByRole('heading', { name: book.title })).toBeVisible();
	screen.unmount();
});

it('loads familiar connections after the main cover, including disliked books without ten ratings', async () => {
	const disliked = {
		...other,
		id: 'uuid-disliked',
		book_id: '01KR2ADTNG29NSQV23VAGV8FXD',
		title: 'A Disliked Book'
	};
	connections.load.mockResolvedValue([
		{ book: other, rating: 5 },
		{ book: disliked, rating: 2 }
	]);
	const fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
	authStore.setSession({ access_token: 'private-token', user: { id: 'reader' } } as Session);
	const screen = render(BookDetailPage, {
		...props,
		book: { ...book, coverUrl: 'https://covers.example/main.avif' }
	});
	await tick();
	expect(connections.load).not.toHaveBeenCalled();
	document.querySelector('.book-cover img')!.dispatchEvent(new Event('load'));
	await expect.element(screen.getByRole('link', { name: /Another Book/ })).toBeVisible();
	await expect.element(screen.getByRole('link', { name: /A Disliked Book/ })).toBeVisible();
	expect(document.querySelector('.reference-books')?.textContent).toContain('Your rating: 2 / 5');
	expect(connections.load).toHaveBeenCalledTimes(1);
	expect(fetchMock).not.toHaveBeenCalled();
	authStore.setSession(null);
	await expect
		.element(screen.getByRole('link', { name: /A Disliked Book/ }))
		.not.toBeInTheDocument();
	screen.unmount();
});

it('shows the existing correction editor on the full page for registered users', async () => {
	authStore.setSession({
		access_token: 'token',
		user: { id: 'reader', is_anonymous: false }
	} as Session);
	const screen = render(BookDetailPage, props);
	await screen.getByRole('button', { name: 'Suggest a correction', exact: true }).click();
	await expect.element(screen.getByRole('button', { name: 'Title', exact: true })).toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Description', exact: true }))
		.toBeVisible();
	expect(document.querySelector('.book-correction .correction__panel')).not.toBeNull();
	authStore.setSession(null);
	await expect
		.element(screen.getByRole('button', { name: 'Suggest a correction', exact: true }))
		.not.toBeInTheDocument();
	screen.unmount();
});

it('keeps the book visible during a failed author lookup and retries on demand', async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(new Response('', { status: 503 }))
		.mockResolvedValueOnce(Response.json({ books: [other], truncated: false }));
	vi.stubGlobal('fetch', fetchMock);
	const screen = render(BookDetailPage, props);
	await screen.getByRole('button', { name: book.author, exact: true }).click();
	await expect
		.element(screen.getByRole('alert'))
		.toHaveTextContent('Couldn’t load other books by this author.');
	await expect.element(screen.getByRole('heading', { name: book.title })).toBeVisible();
	await screen.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect.element(screen.getByRole('link', { name: /Another Book/ })).toBeVisible();
	expect(fetchMock).toHaveBeenCalledTimes(2);
	screen.unmount();
});

it('aborts the old author lookup and resets the correction editor and failed main cover on a book change', async () => {
	let finish: ((response: Response) => void) | undefined;
	const fetchMock = vi.fn<typeof fetch>(
		() =>
			new Promise<Response>((resolve) => {
				finish = resolve;
			})
	);
	vi.stubGlobal('fetch', fetchMock);
	authStore.setSession({
		access_token: 'token',
		user: { id: 'reader', is_anonymous: false }
	} as Session);
	const coverUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
	const screen = render(BookDetailPage, { ...props, book: { ...book, coverUrl } });
	document.querySelector('.book-cover img')!.dispatchEvent(new Event('error'));
	await tick();
	expect(document.querySelector('.book-cover img')).toBeNull();
	await screen.getByRole('button', { name: book.author, exact: true }).click();
	await screen.getByRole('button', { name: 'Suggest a correction', exact: true }).click();
	await expect.element(screen.getByRole('button', { name: 'Title', exact: true })).toBeVisible();
	const signal = fetchMock.mock.calls[0][1]?.signal;
	await screen.rerender({
		book: { ...other, coverUrl },
		canonicalUrl: `https://unread.example/books/${other.slug}`
	});
	expect(signal?.aborted).toBe(true);
	expect(document.querySelector('.author-books')).toBeNull();
	await expect
		.element(screen.getByRole('button', { name: 'Title', exact: true }))
		.not.toBeInTheDocument();
	expect(document.querySelector('.book-cover img')?.getAttribute('alt')).toBe(
		`Cover of ${other.title}`
	);
	finish?.(Response.json({ books: [book], truncated: false }));
	await tick();
	expect(document.querySelector('.author-books')).toBeNull();
	authStore.setSession(null);
	await tick();
	await screen.getByRole('button', { name: 'Save book', exact: true }).click();
	expect(planToReadStore.has(other.id)).toBe(true);
	expect(planToReadStore.has(book.id)).toBe(false);
	screen.unmount();
});
