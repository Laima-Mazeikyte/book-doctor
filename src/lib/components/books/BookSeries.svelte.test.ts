import { beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import BookDetailPage from './BookDetailPage.svelte';
import BookSeries from './BookSeries.svelte';

const navigation = vi.hoisted(() => ({ preload: vi.fn().mockResolvedValue({ status: 200 }) }));
vi.mock('$app/navigation', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/navigation')>()),
	preloadData: navigation.preload
}));
beforeEach(() => navigation.preload.mockClear());

// Keep the error-fallback check independent of requests for nonexistent cover IDs.
vi.mock('$lib/book-cover', () => ({
	coverUrlForBookId: () =>
		'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
	coverUrlForBookIdAtSize: () =>
		'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
}));

const id = (n: number) => `01${String(n).padStart(24, '0')}`;
const series = {
	title: 'Shared Series (An Author)',
	number: 1.5,
	members: [
		{ book_id: id(1), slug: 'book-1', title: 'Book One', number: 1 },
		{ book_id: id(2), slug: 'book-2', title: 'Between Volumes', number: 1.5 },
		{ book_id: id(3), slug: 'book-3', title: 'Book Two', number: 2 }
	]
};
it('shows ordered cover links immediately, highlights the current book, and gives thumbnails low priority', async () => {
	const screen = render(BookSeries, { series, currentBookId: id(2) });
	await expect
		.element(screen.getByText('Shared Series (An Author) · Book 1.5', { exact: true }))
		.toBeVisible();
	expect(
		[...document.querySelectorAll('.series-books a')].map((a) => a.getAttribute('href'))
	).toEqual(['/books/book-1', '/books/book-2', '/books/book-3']);
	for (const link of document.querySelectorAll('.series-books a')) {
		expect(link.hasAttribute('data-sveltekit-noscroll')).toBe(true);
	}
	await expect
		.element(
			screen.getByRole('link', { name: 'Between Volumes, Book 1.5 in Shared Series (An Author)' })
		)
		.toHaveAttribute('aria-current', 'page');
	expect(document.querySelector('.book-series button')).toBeNull();
	expect(document.querySelector('.member-title, .volume')).toBeNull();
	expect(document.querySelectorAll('.series-book--selected')).toHaveLength(1);
	expect(document.querySelector('.series-book--selected')?.getAttribute('href')).toBe(
		'/books/book-2'
	);
	expect(document.querySelectorAll('.series-cover > img')).toHaveLength(0);
	await screen.rerender({ imagesReady: true });
	expect(document.querySelectorAll('.series-cover > img')).toHaveLength(3);
	for (const image of document.querySelectorAll('.series-cover img')) {
		expect(image.getAttribute('loading')).toBe('lazy');
		expect(image.getAttribute('fetchpriority')).toBe('low');
		expect(image.getAttribute('decoding')).toBe('async');
		expect(image.getAttribute('width')).toBe('200');
		expect(image.getAttribute('height')).toBe('300');
		expect(image.getAttribute('alt')).toContain('in Shared Series (An Author)');
	}
	screen.unmount();
});

it('scrolls long series to the current volume on mobile without moving the page and preserves failed-cover links', async () => {
	await page.viewport(390, 844);
	try {
		const members = Array.from({ length: 30 }, (_, i) => ({
			book_id: id(i + 1),
			slug: `book-${i + 1}`,
			title: `Volume ${i + 1}`,
			number: i + 1
		}));
		const beforeScroll = window.scrollY;
		const book = {
			id: 'uuid-long-series',
			book_id: id(22),
			slug: 'book-22',
			title: 'Volume 22',
			author: 'An Author'
		};
		const screen = render(BookDetailPage, {
			book,
			canonicalUrl: 'https://example.com/books/book-22',
			series: { ...series, title: 'A'.repeat(150), members }
		});
		await expect.element(screen.getByRole('link', { name: /^Volume 22,/ })).toBeVisible();
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
		const strip = document.querySelector<HTMLOListElement>('.series-books')!;
		const active = strip.querySelector('[aria-current="page"]')!;
		expect(strip.scrollLeft).toBeGreaterThan(0);
		expect(active.getBoundingClientRect().left).toBeGreaterThanOrEqual(
			strip.getBoundingClientRect().left
		);
		expect(active.getBoundingClientRect().right).toBeLessThanOrEqual(
			strip.getBoundingClientRect().right
		);
		expect(window.scrollY).toBe(beforeScroll);
		await expect.poll(() => document.querySelectorAll('.series-cover > img').length).toBe(30);
		const image = document.querySelector('.series-cover > img')!;
		image.dispatchEvent(new Event('error'));
		await expect.element(screen.getByText('Volume 1', { exact: true })).toBeInTheDocument();
		expect(strip.querySelector('a')?.getAttribute('href')).toBe('/books/book-1');
		await screen.rerender({
			book: { ...book, book_id: id(3), slug: 'book-3', title: 'Book Two' },
			series: { ...series, title: 'Another Series' }
		});
		await expect
			.element(screen.getByRole('link', { name: 'Book Two, Book 2 in Another Series' }))
			.toHaveAttribute('aria-current', 'page');
		expect(document.querySelectorAll('.series-books a')).toHaveLength(3);
		expect(document.querySelector('.series-books')).not.toBe(strip);
		expect(document.querySelector('.series-books')?.scrollLeft).toBe(0);
		screen.unmount();
	} finally {
		await page.viewport(1280, 900);
	}
});

it('retains the same covers and horizontal position when switching volumes, but resets for a new series', async () => {
	await page.viewport(390, 844);
	try {
		const members = Array.from({ length: 30 }, (_, i) => ({
			book_id: id(i + 1),
			slug: `book-${i + 1}`,
			title: `Volume ${i + 1}`,
			number: i + 1
		}));
		const book = {
			id: 'uuid-22',
			book_id: id(22),
			slug: 'book-22',
			title: 'Volume 22',
			author: 'An Author'
		};
		const screen = render(BookDetailPage, {
			book,
			canonicalUrl: 'https://example.com/books/book-22',
			series: { ...series, number: 22, members }
		});
		await expect.poll(() => document.querySelectorAll('.series-cover > img').length).toBe(30);
		const strip = document.querySelector<HTMLOListElement>('.series-books')!;
		const images = [...strip.querySelectorAll('.series-cover > img')];
		strip.scrollLeft -= 37;
		const scrollLeft = strip.scrollLeft;
		await screen.rerender({
			book: { ...book, id: 'uuid-23', book_id: id(23), slug: 'book-23', title: 'Volume 23' },
			canonicalUrl: 'https://example.com/books/book-23',
			series: { ...series, number: 23, members: members.map((member) => ({ ...member })) }
		});
		expect(document.querySelector('.series-books')).toBe(strip);
		expect(strip.scrollLeft).toBe(scrollLeft);
		for (const [i, image] of strip.querySelectorAll('.series-cover > img').entries()) {
			expect(image).toBe(images[i]);
		}
		expect(strip.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe(
			'/books/book-23'
		);
		expect(strip.querySelector('.series-book--selected')?.getAttribute('href')).toBe(
			'/books/book-23'
		);
		expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
			'https://example.com/books/book-23'
		);
		await screen.rerender({
			series: { ...series, title: 'Different Series', number: 23, members }
		});
		expect(document.querySelector('.series-books')).not.toBe(strip);
		expect(document.querySelectorAll('.series-cover > img')).toHaveLength(0);
		await expect.poll(() => document.querySelectorAll('.series-cover > img').length).toBe(30);
		screen.unmount();
	} finally {
		await page.viewport(1280, 900);
	}
});

it('keeps released covers visible while the next volume main-cover gate is closed', async () => {
	const screen = render(BookSeries, { series, currentBookId: id(2), imagesReady: true });
	await expect.poll(() => document.querySelectorAll('.series-cover > img').length).toBe(3);
	const images = [...document.querySelectorAll('.series-cover > img')];
	await screen.rerender({
		series: { ...series, number: 2 },
		currentBookId: id(3),
		imagesReady: false
	});
	for (const [i, image] of document.querySelectorAll('.series-cover > img').entries()) {
		expect(image).toBe(images[i]);
	}
	expect(document.querySelectorAll('.series-cover > img')).toHaveLength(3);
	screen.unmount();
});

it('renders membership without a ranking badge and omits the section for standalone books', async () => {
	const book = {
		id: 'uuid',
		book_id: id(2),
		slug: 'book-2',
		title: 'Between Volumes',
		author: 'An Author'
	};
	const screen = render(BookDetailPage, { book, canonicalUrl: 'https://example.com/book', series });
	await expect
		.element(screen.getByText('Shared Series (An Author) · Book 1.5', { exact: true }))
		.toBeVisible();
	expect(document.querySelector('.book-annotations')?.textContent ?? '').not.toContain('Top ');
	await screen.rerender({ series: null });
	expect(document.querySelector('.book-series')).toBeNull();
	expect(document.body.textContent).not.toContain('Series information coming soon');
	screen.unmount();
});

it('preloads only the next ordered volume after the main-cover gate opens, once per book', async () => {
	const screen = render(BookSeries, { series, currentBookId: id(2) });
	expect(navigation.preload).not.toHaveBeenCalled();
	await screen.rerender({ imagesReady: true });
	await expect.poll(() => navigation.preload.mock.calls.length).toBe(1);
	expect(navigation.preload).toHaveBeenCalledWith('/books/book-3');
	await screen.rerender({ imagesReady: false });
	await screen.rerender({ imagesReady: true });
	expect(navigation.preload).toHaveBeenCalledTimes(1);
	screen.unmount();
});

it('skips speculative reads for reduced-data users and for the final volume', async () => {
	const descriptor = Object.getOwnPropertyDescriptor(navigator, 'connection');
	Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
	const screen = render(BookSeries, { series, currentBookId: id(2), imagesReady: true });
	try {
		await expect.element(screen.getByRole('link', { name: /^Between Volumes,/ })).toBeVisible();
		expect(navigation.preload).not.toHaveBeenCalled();
	} finally {
		screen.unmount();
		if (descriptor) Object.defineProperty(navigator, 'connection', descriptor);
		else Reflect.deleteProperty(navigator, 'connection');
	}
	const last = render(BookSeries, { series, currentBookId: id(3), imagesReady: true });
	await expect.element(last.getByRole('link', { name: /^Book Two,/ })).toBeVisible();
	expect(navigation.preload).not.toHaveBeenCalled();
	last.unmount();
});
