import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
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
const discovery = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('$lib/books/connections', () => ({ loadBookConnections: connections.load }));
vi.mock('$lib/books/discovery', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/books/discovery')>()),
	loadBookDiscovery: discovery.load
}));
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
	discovery.load.mockReset().mockResolvedValue({
		bookId: book.book_id,
		releaseId: 'test',
		similarExperience: [],
		differentDirection: []
	});
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
	expect(document.body.textContent).not.toContain('Similar-experience recommendations coming soon');
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

it('loads both public discovery sections after the main cover without delaying book content', async () => {
	discovery.load.mockResolvedValue({
		bookId: book.book_id,
		releaseId: 'test',
		similarExperience: [{ ...other, reason: { code: 'shared_profile', params: {} } }],
		differentDirection: [
			{
				...other,
				book_id: '01KR2ADTNG29NSQV23VAGV8FXD',
				slug: 'a-new-direction',
				title: 'A New Direction',
				reason: { code: 'dimension_contrast', params: { axis: 'vocabulary', direction: -1 } }
			}
		]
	});
	const screen = render(BookDetailPage, {
		...props,
		book: { ...book, coverUrl: 'https://covers.example/main-discovery.avif' }
	});
	await tick();
	expect(document.querySelector('h1')?.textContent).toBe(book.title);
	expect(discovery.load).not.toHaveBeenCalled();
	document.querySelector('.book-cover img')!.dispatchEvent(new Event('load'));
	await expect.element(screen.getByRole('heading', { name: 'Similar experience' })).toBeVisible();
	await expect
		.element(screen.getByRole('heading', { name: 'A different direction' }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: /A New Direction/ }))
		.toHaveAttribute('href', '/books/a-new-direction');
	await expect.element(screen.getByText('More accessible language')).toBeVisible();
	expect(discovery.load).toHaveBeenCalledTimes(1);
	expect(connections.load).not.toHaveBeenCalled();
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
		.toHaveTextContent('Couldn’t load books by this author.');
	await expect.element(screen.getByRole('heading', { name: book.title })).toBeVisible();
	await screen.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect.element(screen.getByRole('link', { name: /Another Book/ })).toBeVisible();
	expect(fetchMock).toHaveBeenCalledTimes(2);
	screen.unmount();
});

it('keeps all author covers mounted, moves the current-book highlight, and preserves scroll', async () => {
	await page.viewport(390, 844);
	const coverUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
	const collection = [
		book,
		other,
		...Array.from({ length: 46 }, (_, index) => ({
			...book,
			id: `uuid-volume-${index}`,
			book_id: `01${String(index).padStart(24, '0')}`,
			slug: `volume-${index}`,
			title: `Volume ${index}`,
			coverUrl
		}))
	];
	const fetchMock = vi
		.fn()
		.mockResolvedValue(Response.json({ books: collection, truncated: false }));
	vi.stubGlobal('fetch', fetchMock);
	const screen = render(BookDetailPage, props);
	try {
		await screen.getByRole('button', { name: book.author, exact: true }).click();
		await expect.element(screen.getByRole('link', { name: 'Volume 0', exact: true })).toBeVisible();
		const panel = document.querySelector<HTMLElement>('.author-books')!;
		// Component tests do not load the app's theme variables.
		panel.style.setProperty('--color-text', '#202020');
		const retainedLink = panel.querySelector('a[aria-label="Volume 0"]')!;
		const retainedCover = retainedLink.querySelector('img');
		const links = [...panel.querySelectorAll('a')];
		const currentLink = panel.querySelector(`a[href="/books/${book.slug}"]`)!;
		expect(currentLink.getAttribute('aria-current')).toBe('page');
		expect(currentLink.classList.contains('author-book-cover--selected')).toBe(true);
		expect(getComputedStyle(currentLink).boxShadow).not.toBe('none');
		await expect
			.element(
				screen.getByRole('heading', {
					name: `Books by ${book.author}`,
					exact: true
				})
			)
			.toBeVisible();
		panel.scrollTop = 190;
		panel.dispatchEvent(new Event('scroll'));
		const scrollTop = panel.scrollTop;
		expect(scrollTop).toBeGreaterThan(0);
		const pageScroll = window.scrollY;
		expect(panel.querySelectorAll('a')).toHaveLength(48);
		expect(panel.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
		for (const link of panel.querySelectorAll('a')) {
			expect(link.hasAttribute('data-sveltekit-noscroll')).toBe(true);
		}
		await screen.rerender({ book: other });
		await expect
			.element(screen.getByRole('button', { name: other.author, exact: true }))
			.toHaveAttribute('aria-expanded', 'true');
		expect(document.querySelector('.author-books')).toBe(panel);
		expect(panel.scrollTop).toBe(scrollTop);
		expect(window.scrollY).toBe(pageScroll);
		expect(panel.querySelector('a[aria-label="Volume 0"]')).toBe(retainedLink);
		expect(retainedLink.querySelector('img')).toBe(retainedCover);
		expect(panel.querySelector(`a[href="/books/${book.slug}"]`)).toBe(currentLink);
		expect(currentLink.hasAttribute('aria-current')).toBe(false);
		expect(currentLink.classList.contains('author-book-cover--selected')).toBe(false);
		const selectedLink = panel.querySelector(`a[href="/books/${other.slug}"]`)!;
		expect(selectedLink.getAttribute('aria-current')).toBe('page');
		expect(selectedLink.classList.contains('author-book-cover--selected')).toBe(true);
		expect(getComputedStyle(selectedLink).boxShadow).not.toBe('none');
		for (const [index, link] of panel.querySelectorAll('a').entries()) {
			expect(link).toBe(links[index]);
		}
		expect(panel.querySelectorAll('a')).toHaveLength(48);
		expect(panel.textContent).not.toContain('Showing 48 books');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(
			new URL(String(fetchMock.mock.calls[0][0]), location.origin).searchParams.has('exclude')
		).toBe(false);
		// Closing and navigating to another title must retain the reader's choice.
		await screen.getByRole('button', { name: book.author, exact: true }).click();
		await screen.rerender({ book });
		expect(document.querySelector('.author-books')).toBeNull();
		await expect
			.element(screen.getByRole('button', { name: book.author, exact: true }))
			.toHaveAttribute('aria-expanded', 'false');
		await screen.getByRole('button', { name: book.author, exact: true }).click();
		expect(document.querySelector('.author-books')?.scrollTop).toBe(scrollTop);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	} finally {
		screen.unmount();
		await page.viewport(1280, 900);
	}
});

it.each([false, true])(
	'caps the author list at 48, includes the current book, and reports truncation %s',
	async (truncated) => {
		const collection = [
			book,
			other,
			...Array.from({ length: 46 }, (_, index) => ({
				...book,
				id: `uuid-${index}`,
				book_id: `01${String(index).padStart(24, '0')}`,
				slug: `volume-${index}`,
				title: `Volume ${index}`
			}))
		];
		const fetchMock = vi.fn().mockResolvedValue(Response.json({ books: collection, truncated }));
		vi.stubGlobal('fetch', fetchMock);
		const screen = render(BookDetailPage, props);
		await screen.getByRole('button', { name: book.author, exact: true }).click();
		await expect
			.element(screen.getByRole('link', { name: other.title, exact: true }))
			.toBeVisible();
		expect(document.querySelectorAll('.author-book-cover')).toHaveLength(48);
		expect(document.querySelector('.author-books')?.textContent?.includes('Showing 48 books')).toBe(
			truncated
		);
		await screen.rerender({ book: other });
		expect(document.querySelectorAll('.author-book-cover')).toHaveLength(48);
		expect(document.querySelector('.author-books')?.textContent?.includes('Showing 48 books')).toBe(
			truncated
		);
		// The current title can also be outside the retained chronological window.
		const laterBook = {
			...other,
			id: 'uuid-later',
			book_id: '01KR2ADTNG29NSQV23VAGV8FXD',
			slug: 'later-book',
			title: 'Later Book'
		};
		await screen.rerender({ book: laterBook });
		expect(document.querySelectorAll('.author-book-cover')).toHaveLength(48);
		expect(
			document.querySelector('.author-book-cover[aria-current="page"]')?.getAttribute('aria-label')
		).toBe(laterBook.title);
		expect(document.querySelector('.author-books')?.textContent).toContain('Showing 48 books');
		expect(
			[...document.querySelectorAll('.author-book-cover')]
				.slice(0, 47)
				.map((link) => link.getAttribute('aria-label'))
		).toEqual(collection.slice(0, 47).map((item) => item.title));
		expect(
			document.querySelector('.author-book-cover:last-child')?.getAttribute('aria-current')
		).toBe('page');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		screen.unmount();
	}
);

it('keeps a pending author lookup alive across same-author navigation and highlights the latest book', async () => {
	let finish!: (response: Response) => void;
	const fetchMock = vi.fn<typeof fetch>(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	vi.stubGlobal('fetch', fetchMock);
	const screen = render(BookDetailPage, props);
	await screen.getByRole('button', { name: book.author, exact: true }).click();
	const signal = fetchMock.mock.calls[0][1]?.signal;
	await screen.rerender({ book: other });
	expect(signal?.aborted).toBe(false);
	await expect.element(screen.getByRole('status')).toHaveTextContent('Loading books…');
	finish(Response.json({ books: [book, other], truncated: false }));
	await expect.element(screen.getByRole('link', { name: book.title, exact: true })).toBeVisible();
	expect(document.querySelectorAll('.author-book-cover')).toHaveLength(2);
	expect(
		document.querySelector('.author-book-cover[aria-current="page"]')?.getAttribute('href')
	).toBe(`/books/${other.slug}`);
	expect(fetchMock).toHaveBeenCalledTimes(1);
	screen.unmount();
	expect(signal?.aborted).toBe(true);
});

it('discards old-author results even when they arrive after the new author collection', async () => {
	let finishOld!: (response: Response) => void;
	const newBook = { ...other, author: 'Another Author' };
	const newAuthorOther = { ...book, author: newBook.author };
	const fetchMock = vi
		.fn<typeof fetch>()
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishOld = resolve;
				})
		)
		.mockResolvedValue(Response.json({ books: [newBook, newAuthorOther], truncated: false }));
	vi.stubGlobal('fetch', fetchMock);
	const screen = render(BookDetailPage, props);
	await screen.getByRole('button', { name: book.author, exact: true }).click();
	const oldSignal = fetchMock.mock.calls[0][1]?.signal;
	await screen.rerender({ book: newBook });
	expect(oldSignal?.aborted).toBe(true);
	await expect
		.element(screen.getByRole('button', { name: newBook.author, exact: true }))
		.toHaveAttribute('aria-expanded', 'false');
	await screen.getByRole('button', { name: newBook.author, exact: true }).click();
	await expect.element(screen.getByRole('link', { name: book.title, exact: true })).toBeVisible();
	finishOld(Response.json({ books: [], truncated: false }));
	await tick();
	await expect.element(screen.getByRole('link', { name: book.title, exact: true })).toBeVisible();
	// Returning to an earlier author starts a fresh, closed section.
	await screen.rerender({ book });
	expect(document.querySelector('.author-books')).toBeNull();
	await screen.getByRole('button', { name: book.author, exact: true }).click();
	expect(fetchMock).toHaveBeenCalledTimes(3);
	screen.unmount();
});

it.each([false, true])(
	'includes and highlights the current book even when the collection is empty: %s',
	async (empty) => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(Response.json({ books: empty ? [] : [book], truncated: false }))
		);
		const screen = render(BookDetailPage, props);
		await screen.getByRole('button', { name: book.author, exact: true }).click();
		await expect.element(screen.getByRole('link', { name: book.title, exact: true })).toBeVisible();
		expect(document.querySelectorAll('.author-book-cover')).toHaveLength(1);
		expect(document.querySelector('.author-book-cover')?.getAttribute('aria-current')).toBe('page');
		expect(document.querySelector('.author-book-cover--selected')).not.toBeNull();
		screen.unmount();
	}
);

it('aborts the old author lookup on an author change and resets book-specific correction and cover state', async () => {
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
		book: { ...other, author: 'Another Author', coverUrl },
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
