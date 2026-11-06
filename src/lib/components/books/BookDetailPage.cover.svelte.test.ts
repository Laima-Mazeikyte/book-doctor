import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Session } from '@supabase/supabase-js';
import { authStore, markAuthInitReady } from '$lib/stores/auth';
import { librarySaves } from '$lib/stores/librarySaves';
import { libraryLoads } from '$lib/stores/libraryLoads';
import { markUserLibraryIdsReady } from '$lib/stores/userLibrary';
import type { Book } from '$lib/types/book';
import BookDetailPage from './BookDetailPage.svelte';

const api = vi.hoisted(() => ({ connections: vi.fn(), discovery: vi.fn() }));
vi.mock('$lib/books/connections', () => ({ loadBookConnections: api.connections }));
vi.mock('$lib/books/discovery', async (original) => ({
	...(await original<typeof import('$lib/books/discovery')>()),
	loadBookDiscovery: api.discovery
}));
vi.mock('$lib/supabase', () => ({ getSupabase: () => ({}) }));
vi.mock('$app/navigation', async (original) => ({
	...(await original<typeof import('$app/navigation')>()),
	preloadData: vi.fn().mockResolvedValue({ status: 200 })
}));
vi.mock('$lib/book-cover', async (original) => ({
	...(await original<typeof import('$lib/book-cover')>()),
	coverUrlForBookIdAtSize: () =>
		'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
}));

const cover = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const book: Book = {
	id: 'uuid-one',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	slug: 'first-book',
	title: 'First Book',
	author: 'An Author',
	coverUrl: cover
};
const other: Book = {
	...book,
	id: 'uuid-two',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXC',
	slug: 'second-book',
	title: 'Second Book'
};
const series = {
	title: 'A Series',
	number: 1,
	members: [
		{ book_id: book.book_id, slug: book.slug!, title: book.title, number: 1 },
		{ book_id: other.book_id, slug: other.slug!, title: other.title, number: 2 }
	]
};
let screen: ReturnType<typeof render> | undefined;
let complete = false;
let naturalWidth = 1;
const originalComplete = Object.getOwnPropertyDescriptor(
	HTMLImageElement.prototype,
	'complete'
)!.get!;
const originalWidth = Object.getOwnPropertyDescriptor(
	HTMLImageElement.prototype,
	'naturalWidth'
)!.get!;

// Hold image completion deterministically without external networking. Only explicit
// synthetic events below reach the component; native data-URL events are suppressed.
function holdNativeCoverEvent(event: Event) {
	if (
		event.isTrusted &&
		event.target instanceof HTMLImageElement &&
		event.target.matches('.book-cover img')
	)
		event.stopImmediatePropagation();
}
async function paint() {
	await new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	);
	await tick();
}
function mount(target = book) {
	screen = render(BookDetailPage, {
		book: target,
		canonicalUrl: 'https://example.com/books/' + target.slug,
		series
	});
	return screen;
}
function expectReleased(target = book) {
	expect(api.discovery).toHaveBeenCalledTimes(1);
	expect(api.discovery.mock.calls[0][1]).toBe(target.book_id);
	expect(api.connections).toHaveBeenCalledTimes(1);
	expect(api.connections.mock.calls[0][1]).toBe(target.book_id);
	expect(document.querySelectorAll('.series-cover > img')).toHaveLength(2);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
	complete = false;
	naturalWidth = 1;
	document.addEventListener('load', holdNativeCoverEvent, true);
	document.addEventListener('error', holdNativeCoverEvent, true);
	vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(function (
		this: HTMLImageElement
	) {
		return this.matches('.book-cover img') ? complete : originalComplete.call(this);
	});
	vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(function (
		this: HTMLImageElement
	) {
		return this.matches('.book-cover img') ? naturalWidth : originalWidth.call(this);
	});
	api.connections.mockReset().mockResolvedValue([]);
	api.discovery.mockReset().mockImplementation(async (_, bookId: string) => ({
		bookId,
		releaseId: null,
		similarExperience: [],
		differentDirection: []
	}));
	librarySaves.discard();
	librarySaves.activateOwner('reader');
	authStore.setSession({
		user: { id: 'reader', is_anonymous: true },
		access_token: 'token'
	} as Session);
	markAuthInitReady();
	markUserLibraryIdsReady('reader');
});
afterEach(() => {
	screen?.unmount();
	screen = undefined;
	document.removeEventListener('load', holdNativeCoverEvent, true);
	document.removeEventListener('error', holdNativeCoverEvent, true);
	vi.useRealTimers();
	vi.restoreAllMocks();
	authStore.setSession(null);
	libraryLoads.reset();
});

it('falls back at five seconds and releases all three sections without image events', async () => {
	mount();
	await tick();
	const image = document.querySelector('.book-cover img')!;
	expect(document.querySelector('h1')?.textContent).toBe(book.title);
	await vi.advanceTimersByTimeAsync(4_999);
	expect(document.querySelector('.book-cover img')).toBe(image);
	expect(api.discovery).not.toHaveBeenCalled();
	expect(api.connections).not.toHaveBeenCalled();
	expect(document.querySelectorAll('.series-cover > img')).toHaveLength(0);
	await vi.advanceTimersByTimeAsync(1);
	expect(document.querySelector('.book-cover img')).toBeNull();
	expect(document.querySelector('.cover-fallback')?.textContent).toContain(book.title);
	expectReleased();
	image.dispatchEvent(new Event('load'));
	image.dispatchEvent(new Event('error'));
	await vi.advanceTimersByTimeAsync(10_000);
	expectReleased();
});

it.each(['load', 'error'])(
	'releases promptly on %s and cancels the cover deadline',
	async (event) => {
		mount();
		await tick();
		document.querySelector('.book-cover img')!.dispatchEvent(new Event(event));
		await paint();
		expectReleased();
		expect(!!document.querySelector('.cover-fallback')).toBe(event === 'error');
		await vi.advanceTimersByTimeAsync(10_000);
		expectReleased();
		expect(!!document.querySelector('.cover-fallback')).toBe(event === 'error');
	}
);

it('shows missing covers immediately and releases without waiting for the deadline', async () => {
	mount({ ...book, coverUrl: undefined });
	await paint();
	expect(document.querySelector('.book-cover img')).toBeNull();
	expect(document.querySelector('.cover-fallback')?.textContent).toContain(book.author);
	expectReleased();
});

it.each([0, 200])('handles an already-complete cover with natural width %i', async (width) => {
	complete = true;
	naturalWidth = width;
	mount();
	await paint();
	expectReleased();
	expect(!!document.querySelector('.cover-fallback')).toBe(width === 0);
});

it('cancels an old book deadline and ignores its late events after navigation', async () => {
	const mounted = mount();
	await tick();
	const oldImage = document.querySelector('.book-cover img')!;
	await vi.advanceTimersByTimeAsync(3_000);
	await mounted.rerender({ book: other });
	oldImage.dispatchEvent(new Event('error'));
	await vi.advanceTimersByTimeAsync(2_000);
	expect(document.querySelector('.book-cover img')?.getAttribute('alt')).toBe(
		'Cover of Second Book'
	);
	expect(document.querySelector('.cover-fallback')).toBeNull();
	expect(api.discovery).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(3_000);
	expect(document.querySelector('.cover-fallback')?.textContent).toContain(other.title);
	expectReleased(other);
});

it('starts a fresh cover wait when navigating A to B to A', async () => {
	const mounted = mount();
	await tick();
	document.querySelector('.book-cover img')!.dispatchEvent(new Event('load'));
	await paint();
	expectReleased();
	await mounted.rerender({ book: other });
	await vi.advanceTimersByTimeAsync(1_000);
	await mounted.rerender({ book });
	await vi.advanceTimersByTimeAsync(4_999);
	expect(api.discovery).toHaveBeenCalledTimes(1);
	expect(document.querySelector('.book-cover img')).not.toBeNull();
	await vi.advanceTimersByTimeAsync(1);
	expect(api.discovery).toHaveBeenCalledTimes(2);
	expect(api.connections).toHaveBeenCalledTimes(2);
	expect(document.querySelector('.cover-fallback')?.textContent).toContain(book.title);
});

it('releases by the deadline if paint callbacks are suspended after a successful load', async () => {
	vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
	vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
	mount();
	await tick();
	document.querySelector('.book-cover img')!.dispatchEvent(new Event('load'));
	await vi.advanceTimersByTimeAsync(4_999);
	expect(api.discovery).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expectReleased();
	expect(document.querySelector('.cover-fallback')).toBeNull();
});

it('cleans up pending timeouts and paint callbacks on unmount', async () => {
	const mounted = mount();
	await tick();
	document.querySelector('.book-cover img')!.dispatchEvent(new Event('load'));
	mounted.unmount();
	screen = undefined;
	await vi.advanceTimersByTimeAsync(10_000);
	await paint();
	expect(api.discovery).not.toHaveBeenCalled();
	expect(api.connections).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});
