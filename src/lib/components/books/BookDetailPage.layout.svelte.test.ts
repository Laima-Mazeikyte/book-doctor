import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Session } from '@supabase/supabase-js';
import '../../../app.css';
import { authStore, markAuthInitReady } from '$lib/stores/auth';
import { libraryLoads } from '$lib/stores/libraryLoads';
import { librarySaves } from '$lib/stores/librarySaves';
import { notInterestedStore } from '$lib/stores/notInterested';
import BookDetailPage from './BookDetailPage.svelte';

const api = vi.hoisted(() => ({ connections: vi.fn(), discovery: vi.fn() }));
vi.mock('$lib/supabase', () => ({ getSupabase: () => ({}) }));
vi.mock('$lib/books/connections', () => ({ loadBookConnections: api.connections }));
vi.mock('$lib/books/discovery', async (original) => ({
	...(await original<typeof import('$lib/books/discovery')>()),
	loadBookDiscovery: api.discovery
}));
vi.mock('$lib/book-cover', () => ({
	coverUrlForBookId: () => undefined,
	coverUrlForBookIdAtSize: () =>
		'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
}));

const longAuthor = 'AlexandrosPapadiamantopoulosTheodorakopoulos';
const longTitle = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
const book = {
	id: 'layout-main',
	book_id: '01000000000000000000000001',
	slug: 'layout-example',
	title: longTitle,
	author: longAuthor,
	summary: 'Long text should stay within the available page width.'
};
let main: HTMLElement;
const originalFontSize = document.documentElement.style.fontSize;

beforeAll(async () => {
	await Promise.all(
		['/fonts/bespoke-serif/bespoke-serif.css', '/fonts/inter/inter.css'].map(
			(href) =>
				new Promise<void>((resolve, reject) => {
					const link = document.createElement('link');
					link.rel = 'stylesheet';
					link.href = href;
					link.onload = () => resolve();
					link.onerror = () => reject(new Error(`Could not load layout-test font CSS: ${href}`));
					document.head.append(link);
				})
		)
	);
});

beforeEach(() => {
	librarySaves.discard();
	librarySaves.activateOwner('layout-reader');
	libraryLoads.reset();
	notInterestedStore.reset();
	authStore.setSession({
		user: { id: 'layout-reader', is_anonymous: true },
		access_token: 'fixture-token'
	} as Session);
	markAuthInitReady();
	libraryLoads.markSnapshot('layout-reader', ['ratings', 'bookmarks', 'dismissals']);
	api.connections.mockReset().mockResolvedValue([
		{
			book: { ...book, book_id: '01000000000000000000000002', slug: 'connected-example' },
			rating: 3
		}
	]);
	api.discovery.mockReset().mockResolvedValue({
		bookId: book.book_id,
		releaseId: null,
		similarExperience: [],
		differentDirection: []
	});
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			Response.json({
				books: [{ book_id: book.book_id, slug: book.slug, title: book.title }],
				truncated: false
			})
		)
	);
	main = document.createElement('main');
	main.className = 'main-book-grid-shell';
	document.body.append(main);
});

afterEach(async () => {
	main.remove();
	document.documentElement.style.fontSize = originalFontSize;
	vi.unstubAllGlobals();
	await page.viewport(1280, 900);
});

it.each([
	[320, 16],
	[390, 16],
	[600, 16],
	[601, 16],
	[1100, 16],
	[1101, 16],
	[390, 24]
])(
	'keeps long metadata contained at %ipx with %ipx text and preserves controls',
	async (width, size) => {
		await page.viewport(width, 900);
		document.documentElement.style.fontSize = `${size}px`;
		const screen = render(BookDetailPage, {
			target: main,
			props: { book, canonicalUrl: 'https://example.com/books/layout-example' }
		});
		try {
			await expect
				.element(screen.getByRole('heading', { name: 'Similar books you’ve read' }))
				.toBeVisible();
			await document.fonts.ready;
			const connection = main.querySelector<HTMLAnchorElement>('.reference-books a')!;
			const information = main.querySelector<HTMLElement>('.book-information')!;
			const author = main.querySelector<HTMLButtonElement>('.author-button')!;
			const cover = connection.querySelector('img')!;
			expect(connection.scrollWidth).toBeLessThanOrEqual(connection.clientWidth + 1);
			expect(cover.getBoundingClientRect().width).toBeCloseTo(3.2 * size, 0);
			expect(connection.textContent).toContain(longTitle);
			expect(connection.textContent).toContain(longAuthor);
			expect(connection.getAttribute('href')).toBe('/books/connected-example');
			expect(author.getBoundingClientRect().right).toBeLessThanOrEqual(
				information.getBoundingClientRect().right + 1
			);
			expect(author.querySelector('svg')!.getBoundingClientRect().width).toBeCloseTo(18, 0);
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
				document.documentElement.clientWidth + 1
			);
			const fallback = main.querySelector<HTMLElement>('.cover-fallback')!;
			expect(fallback.scrollWidth).toBeLessThanOrEqual(fallback.clientWidth + 1);
			author.focus();
			expect(document.activeElement).toBe(author);
			await screen.getByRole('button', { name: longAuthor, exact: true }).click();
			await expect
				.element(screen.getByRole('heading', { name: `Books by ${longAuthor}` }))
				.toBeVisible();
			const panel = main.querySelector<HTMLElement>('.author-books')!;
			expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
				document.documentElement.clientWidth + 1
			);
			await expect
				.element(screen.getByRole('button', { name: longAuthor, exact: true }))
				.toHaveAttribute('aria-expanded', 'true');
			await screen.getByRole('button', { name: longAuthor, exact: true }).click();
			expect(main.querySelector('.author-books')).toBeNull();
		} finally {
			screen.unmount();
		}
	}
);
