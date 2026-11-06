import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { tick } from 'svelte';
import Harness from './test-support/VirtualFeedHarness.svelte';
import { authStore, markAuthInitReady } from '$lib/stores/auth';
import { librarySaves } from '$lib/stores/librarySaves';
import { libraryLoads, LIBRARY_COLLECTIONS } from '$lib/stores/libraryLoads';
import { ratingsStore } from '$lib/stores/ratings';
import { bookSummarySheetHistory } from '$lib/stores/bookSummarySheetHistory';
import type { Session } from '@supabase/supabase-js';

const appPage = vi.hoisted(() => ({ current: { state: {} as App.PageState } }));
vi.mock('$app/stores', () => ({
	page: {
		subscribe(run: (value: unknown) => void) {
			run({ ...appPage.current, url: new URL('http://localhost/rate') });
			return () => {};
		}
	}
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/navigation', () => ({
	pushState: (_url: string, state: App.PageState) => {
		appPage.current = { state };
		window.history.pushState(state, '', location.href);
	},
	replaceState: (_url: string, state: App.PageState) => {
		appPage.current = { state };
		window.history.replaceState(state, '', location.href);
	},
	goto: vi.fn(),
	preloadData: vi.fn().mockResolvedValue({ status: 200 })
}));
const books = Array.from({ length: 1000 }, (_, index) => ({
	id: `uuid-${index}`,
	book_id: `ulid-${index}`,
	title: `Book ${index}`,
	author: 'Author',
	summary: 'Summary'
}));
let view: ReturnType<typeof render<typeof Harness>>;
const list = () => document.querySelector<HTMLUListElement>('.virtual-feed')!;
const mounted = () => document.querySelectorAll('[data-feed-book]').length;
async function frames() {
	await tick();
	await new Promise(requestAnimationFrame);
	await tick();
	await new Promise(requestAnimationFrame);
}
async function jump(index: number) {
	const node = list();
	const cols = getComputedStyle(node).gridTemplateColumns.split(/\s+/).length;
	const height = node
		.querySelector<HTMLElement>('[data-feed-book]')!
		.getBoundingClientRect().height;
	const gap = parseFloat(getComputedStyle(node).rowGap);
	window.scrollTo(
		0,
		window.scrollY +
			node.getBoundingClientRect().top +
			Math.floor(index / cols) * (height + gap) +
			5
	);
	await expect.poll(() => !!node.querySelector(`[data-feed-index="${index}"]`)).toBe(true);
	await frames();
}
beforeEach(async () => {
	await page.viewport(1280, 900);
	window.scrollTo(0, 0);
	librarySaves.activateOwner('virtual-reader');
	librarySaves.discard();
	ratingsStore.reset();
	authStore.setSession({ user: { id: 'virtual-reader' }, access_token: 'test' } as Session);
	markAuthInitReady();
	libraryLoads.markSnapshot('virtual-reader', LIBRARY_COLLECTIONS);
	appPage.current = { state: {} };
});
afterEach(() => {
	view?.unmount();
	bookSummarySheetHistory.set(null);
	librarySaves.discard();
	libraryLoads.reset();
	authStore.setSession(null);
	window.scrollTo(0, 0);
});

it('bounds 1000 real cards, preserves height, restores ratings, and exposes the logical tail', async () => {
	view = render(Harness, { books });
	await frames();
	expect(mounted()).toBeLessThan(100);
	const height = list().getBoundingClientRect().height;
	ratingsStore.setRating(books[0].id, 4, books[0].book_id, books[0]);
	await jump(650);
	expect(mounted()).toBeLessThan(100);
	expect(list().querySelector('[data-feed-index="0"]')).toBeNull();
	expect(Math.abs(list().getBoundingClientRect().height - height)).toBeLessThan(2);
	await jump(0);
	await expect
		.element(
			page.getByRole('button', { name: 'Rate 4 out of 5 (click again to clear)', exact: true })
		)
		.toHaveAttribute('aria-pressed', 'true');
	await jump(999);
	await expect
		.element(page.getByRole('button', { name: 'Load more books', exact: true }))
		.toBeVisible();
	expect(mounted()).toBeLessThan(100);
});

it('retains the summary owner across distant scrolling and releases it after close', async () => {
	view = render(Harness, { books });
	await frames();
	await page
		.getByRole('button', { name: 'Book 0 by Author. See summary', exact: true })
		.first()
		.click();
	await expect.element(page.getByRole('dialog')).toBeVisible();
	await jump(650);
	await expect.element(page.getByRole('dialog')).toBeVisible();
	expect(mounted()).toBeLessThan(110);
	await page.getByRole('button', { name: 'Close summary', exact: true }).click();
	// The rate page consumes this entry after the shallow Back; this isolated harness has no router.
	bookSummarySheetHistory.set(null);
	await frames();
	expect(
		document.activeElement?.closest('[data-feed-index]')?.getAttribute('data-feed-index')
	).toBe('0');
	(document.activeElement as HTMLElement).blur();
	await frames();
	await jump(650);
	expect(list().querySelector('[data-feed-index="0"]')).toBeNull();
});

it('keeps focus and follows logical Tab order through a disconnected retained row', async () => {
	view = render(Harness, { books });
	await frames();
	const controls = list()
		.querySelector('[data-feed-index="0"]')!
		.querySelectorAll<HTMLButtonElement>('button');
	controls[controls.length - 1].focus();
	await frames();
	await jump(650);
	expect(document.activeElement).toBe(controls[controls.length - 1]);
	await userEvent.keyboard('{Tab}');
	await frames();
	expect(
		document.activeElement?.closest('[data-feed-index]')?.getAttribute('data-feed-index')
	).toBe('1');
	await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
	await frames();
	expect(
		document.activeElement?.closest('[data-feed-index]')?.getAttribute('data-feed-index')
	).toBe('0');
	expect(mounted()).toBeLessThan(110);
});

it('preserves a visible book when the grid changes from desktop to mobile columns', async () => {
	view = render(Harness, { books });
	await frames();
	await jump(500);
	await page.viewport(390, 844);
	await frames();
	const cell = list().querySelector<HTMLElement>('[data-feed-index="500"]');
	expect(cell).not.toBeNull();
	expect(Math.abs(cell!.getBoundingClientRect().top)).toBeLessThan(100);
	expect(mounted()).toBeLessThan(110);
});

it('appends data without remounting the visible row or shifting its scroll position', async () => {
	view = render(Harness, { books });
	await frames();
	await jump(650);
	const cell = list().querySelector<HTMLElement>('[data-feed-index="650"]')!;
	const top = cell.getBoundingClientRect().top;
	const scroll = window.scrollY;
	await view.rerender({
		books: [
			...books,
			...books
				.slice(0, 50)
				.map((book) => ({ ...book, id: `next-${book.id}`, book_id: `next-${book.book_id}` }))
		]
	});
	await frames();
	expect(list().querySelector('[data-feed-index="650"]')).toBe(cell);
	expect(Math.abs(cell.getBoundingClientRect().top - top)).toBeLessThan(2);
	expect(window.scrollY).toBe(scroll);
	expect(mounted()).toBeLessThan(100);
});

it('remembers a failed cover when its card is unmounted and revisited', async () => {
	let errors = 0;
	const failed = () => {
		errors++;
	};
	document.addEventListener('error', failed, true);
	try {
		view = render(Harness, {
			books: [{ ...books[0], coverUrl: 'data:image/png;base64,broken' }, ...books.slice(1)]
		});
		await expect.poll(() => errors).toBe(1);
		await jump(650);
		await jump(0);
		await frames();
		expect(errors).toBe(1);
		expect(list().querySelector('[data-feed-index="0"] img')).toBeNull();
	} finally {
		document.removeEventListener('error', failed, true);
	}
});

it('switches to windowed rows as the feed grows without replacing the current card', async () => {
	const originalAnchor = document.documentElement.style.overflowAnchor;
	view = render(Harness, { books: books.slice(0, 100) });
	await frames();
	const first = list().querySelector('[data-feed-index="0"]');
	expect(mounted()).toBe(100);
	expect(document.documentElement.style.overflowAnchor).toBe(originalAnchor);
	await view.rerender({ books: books.slice(0, 150) });
	await frames();
	expect(list().querySelector('[data-feed-index="0"]')).toBe(first);
	expect(mounted()).toBeLessThan(100);
	expect(document.documentElement.style.overflowAnchor).toBe('none');
	await view.rerender({ books: books.slice(0, 50) });
	await frames();
	expect(mounted()).toBe(50);
	expect(document.documentElement.style.overflowAnchor).toBe(originalAnchor);
});
