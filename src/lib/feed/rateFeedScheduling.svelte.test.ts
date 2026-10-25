import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { afterNavigate } from '$app/navigation';
import type { Session } from '@supabase/supabase-js';
import RatePage from '../../routes/rate/+page.svelte';
import { authStore, markAuthInitReady } from '$lib/stores/auth';
import { ratingsStore } from '$lib/stores/ratings';
import { planToReadStore } from '$lib/stores/planToRead';
import { notInterestedStore } from '$lib/stores/notInterested';
import { insertFeedRequestRow, pollCuratedFeedRequest } from './warmCuratedFeed';
import {
	createRateFeedController,
	type LatestFeedStateResponse,
	type RateFeedController
} from './rateFeedController';
import RateFeedHarness from './test-support/RateFeedHarness.svelte';
import { createRateFeedCache, RATE_FEED_CACHE_PREFIX, type RateFeedCache } from './rateFeedCache';
import { libraryLoads } from '$lib/stores/libraryLoads';
import { librarySaves } from '$lib/stores/librarySaves';

vi.mock('$app/navigation', () => ({
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	goto: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn()
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/stores', async () => ({
	page: (await import('svelte/store')).writable({
		url: new URL('http://localhost/rate'),
		state: {}
	})
}));
vi.mock('$lib/supabase', () => ({ getSupabase: () => ({}) }));
vi.mock('$lib/stores/recommendationsCount', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/stores/recommendationsCount')>()),
	refreshRecommendationsCountFromApi: vi.fn()
}));
vi.mock('$lib/components/BookCard.svelte', async () => ({
	default: (await import('$lib/recommendations/test-support/TestBookCard.svelte')).default
}));
vi.mock('./warmCuratedFeed', () => ({
	insertFeedRequestRow: vi.fn(),
	pollCuratedFeedRequest: vi.fn()
}));

const books = Array.from({ length: 50 }, (_, i) => ({
	id: `feed-book-${i}`,
	book_id: `feed-ulid-${i}`,
	title: `Book ${i}`,
	author: 'Author'
}));

function feedPayload(incoming = books): LatestFeedStateResponse {
	return {
		mode: 'has_eligible_feed',
		books: incoming,
		request_id: '42',
		latest_request_id: '42',
		latest_request_status: 'completed',
		latest_request_error_message: null,
		interaction_count: 1,
		ratings_count: 1,
		eligible_for_feed: true,
		status: 'completed',
		error_message: null
	};
}

function pendingRead() {
	let resolve!: (payload: LatestFeedStateResponse) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<LatestFeedStateResponse>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

async function frames(count = 3) {
	for (let i = 0; i < count; i++) {
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		await tick();
	}
}

describe('rate feed progress scheduling', () => {
	let visibleCards: number;
	let cardMeasurements: number;
	let rendered: ReturnType<typeof render> | undefined;
	let observers: Array<{ notify: () => void; disconnected: boolean }>;
	let sharedController: RateFeedController | undefined;

	function sharedFeed(cache?: RateFeedCache) {
		const readLatest = vi.fn().mockResolvedValue(feedPayload());
		sharedController = createRateFeedController({ readLatest, cache });
		sharedController.setOwner('test-user');
		return { controller: sharedController, readLatest };
	}
	function cachedFeed() {
		librarySaves.activateOwner('test-user');
		ratingsStore.hydrate([{ bookId: 'already-rated', rating: 4 }]);
		libraryLoads.markSnapshot('test-user', ['ratings', 'bookmarks', 'dismissals']);
		const cache = createRateFeedCache();
		cache.write({
			version: 1,
			ownerId: 'test-user',
			fetchedAt: 1000,
			source: { kind: 'curated', requestId: 'cached-request' },
			books
		});
		return { ...sharedFeed(cache), cache };
	}

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
		vi.setSystemTime(10_000);
		visibleCards = 5;
		cardMeasurements = 0;
		observers = [];
		localStorage.removeItem(RATE_FEED_CACHE_PREFIX + 'test-user');
		librarySaves.discard();
		planToReadStore.reset();
		notInterestedStore.reset();
		ratingsStore.hydrate([{ bookId: 'already-rated', rating: 4 }]);
		libraryLoads.reset();
		authStore.setSession({
			access_token: 'test-token',
			user: { id: 'test-user' }
		} as Session);
		markAuthInitReady();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					mode: 'has_eligible_feed',
					books,
					request_id: 'initial-request',
					interaction_count: 1,
					eligible_for_feed: true,
					status: 'completed'
				})
			})
		);
		vi.mocked(insertFeedRequestRow).mockReset().mockResolvedValue('next-request');
		vi.mocked(pollCuratedFeedRequest)
			.mockReset()
			.mockImplementation(() => new Promise(() => {}));
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				private record: { notify: () => void; disconnected: boolean };
				constructor(callback: IntersectionObserverCallback) {
					this.record = {
						notify: () =>
							callback(
								[{ isIntersecting: true } as IntersectionObserverEntry],
								this as unknown as IntersectionObserver
							),
						disconnected: false
					};
					observers.push(this.record);
				}
				observe() {}
				disconnect() {
					this.record.disconnected = true;
				}
			}
		);
		const originalRect = Element.prototype.getBoundingClientRect;
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
			this: Element
		) {
			if (this.tagName === 'LI' && this.parentElement?.classList.contains('book-card-grid')) {
				cardMeasurements++;
				const index = Array.from(this.parentElement.children).indexOf(this);
				return new DOMRect(0, index < visibleCards ? 10 : window.innerHeight + 1000, 200, 300);
			}
			if (this.classList.contains('rate-page__sentinel')) {
				return new DOMRect(0, window.innerHeight + 500, 1, 1);
			}
			return originalRect.call(this);
		});
	});

	afterEach(() => {
		rendered?.unmount();
		rendered = undefined;
		sharedController?.destroy();
		sharedController = undefined;
		localStorage.removeItem(RATE_FEED_CACHE_PREFIX + 'test-user');
		libraryLoads.reset();
		window.scrollTo(0, 0);
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
		authStore.setSession(null);
		ratingsStore.hydrate([]);
	});

	it('stays idle and keeps observers and scroll listeners through progress updates', async () => {
		const addListener = vi.spyOn(window, 'addEventListener');
		rendered = render(RatePage);
		await frames();
		expect(cardMeasurements).toBe(50);
		const observerCount = observers.length;
		const scrollListeners = () =>
			addListener.mock.calls.filter(([type]) => type === 'scroll').length;
		const listenerCount = scrollListeners();
		for (const observer of observers.filter((o) => !o.disconnected)) observer.notify();
		visibleCards = 10;
		window.dispatchEvent(new Event('scroll'));
		await frames();
		expect(cardMeasurements).toBe(100);
		expect(observers.length).toBe(observerCount);
		expect(scrollListeners()).toBe(listenerCount);
		await vi.advanceTimersByTimeAsync(2000);
		await frames();
		expect(cardMeasurements).toBe(150);
		await frames();
		expect(cardMeasurements).toBe(150);
		expect(observers.length).toBe(observerCount);
		expect(insertFeedRequestRow).not.toHaveBeenCalled();
	});

	it('unlocks at the dwell deadline without another scroll and requests only once', async () => {
		visibleCards = 25;
		rendered = render(RatePage);
		await frames();
		for (const observer of observers.filter((o) => !o.disconnected)) observer.notify();
		await vi.advanceTimersByTimeAsync(1999);
		await frames();
		expect(insertFeedRequestRow).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await frames();
		expect(insertFeedRequestRow).toHaveBeenCalledTimes(1);
		expect(pollCuratedFeedRequest).toHaveBeenCalledTimes(1);
		window.dispatchEvent(new Event('scroll'));
		window.dispatchEvent(new Event('resize'));
		await vi.advanceTimersByTimeAsync(2000);
		await frames();
		expect(insertFeedRequestRow).toHaveBeenCalledTimes(1);
	});

	it('cancels the pending dwell check on unmount', async () => {
		visibleCards = 25;
		rendered = render(RatePage);
		await frames();
		const measurements = cardMeasurements;
		rendered.unmount();
		rendered = undefined;
		await vi.advanceTimersByTimeAsync(3000);
		await frames();
		expect(cardMeasurements).toBe(measurements);
		expect(insertFeedRequestRow).not.toHaveBeenCalled();
	});

	it('arms a fresh dwell deadline when another batch is appended', async () => {
		visibleCards = 75;
		vi.mocked(pollCuratedFeedRequest).mockResolvedValueOnce({
			kind: 'completed',
			books: books.map((book) => ({
				...book,
				id: `${book.id}-next`,
				book_id: `${book.book_id}-next`
			}))
		});
		rendered = render(RatePage);
		await frames();
		await vi.advanceTimersByTimeAsync(2000);
		await frames();
		expect(document.querySelectorAll('[data-testid="test-book-card"]').length).toBe(100);
		expect(insertFeedRequestRow).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1999);
		await frames();
		expect(insertFeedRequestRow).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		await frames();
		expect(insertFeedRequestRow).toHaveBeenCalledTimes(2);
	});

	it('pauses while search is open and rechecks progress when it closes', async () => {
		visibleCards = 25;
		rendered = render(RatePage);
		await frames();
		document.querySelector<HTMLButtonElement>('.search-bar__trigger')!.click();
		await frames();
		expect(document.querySelector('.rate-search-overlay')).not.toBeNull();
		const measurements = cardMeasurements;
		await vi.advanceTimersByTimeAsync(3000);
		await frames();
		expect(cardMeasurements).toBe(measurements);
		expect(insertFeedRequestRow).not.toHaveBeenCalled();
		document.querySelector<HTMLButtonElement>('.rate-search-overlay__icon-btn')!.click();
		await frames(5);
		expect(document.querySelector('.rate-search-overlay')).toBeNull();
		expect(insertFeedRequestRow).toHaveBeenCalledTimes(1);
	});

	it('joins preparation already in flight and reuses it across a page unmount and remount', async () => {
		const { controller, readLatest } = sharedFeed();
		const read = pendingRead();
		readLatest.mockReturnValueOnce(read.promise);
		const preparation = controller.prepare({ userId: 'test-user', accessToken: 'test-token' });
		rendered = render(RateFeedHarness, { controller });
		await frames();
		rendered.unmount();
		rendered = render(RateFeedHarness, { controller });
		await frames();
		read.resolve(feedPayload());
		await preparation;
		await frames();
		expect(document.querySelectorAll('[data-testid="test-book-card"]').length).toBe(50);
		expect(readLatest).toHaveBeenCalledTimes(1);
		expect(insertFeedRequestRow).not.toHaveBeenCalled();
	});

	it.each(['reordered', 'empty', 'failed'] as const)(
		'keeps mounted cards, order, and scroll through a delayed %s refresh',
		async (outcome) => {
			const { controller, readLatest } = sharedFeed();
			rendered = render(RateFeedHarness, { controller });
			await frames();
			const list = document.querySelector<HTMLElement>('.rate-page__list.book-card-grid')!;
			list.style.minHeight = '4000px';
			window.scrollTo(0, 300);
			await frames();
			const scroll = window.scrollY;
			expect(scroll).toBe(300);
			const nodes = Array.from(list.querySelectorAll('[data-testid="test-book-card"]'));
			const read = pendingRead();
			readLatest.mockReturnValueOnce(read.promise);
			const refresh = controller
				.prepare({ userId: 'test-user', accessToken: 'test-token' }, { force: true })
				.catch(() => null);
			await vi.advanceTimersByTimeAsync(3000);
			await frames();
			expect(document.querySelector('.rate-page__list[aria-busy="true"]')).toBeNull();
			expect(Array.from(list.querySelectorAll('[data-testid="test-book-card"]'))).toEqual(nodes);
			Array.from(list.querySelectorAll('[data-testid="test-book-card"]')).forEach((node, index) => {
				expect(node).toBe(nodes[index]);
			});
			if (outcome === 'failed') read.reject(new Error('Temporary outage'));
			else
				read.resolve(
					feedPayload(
						outcome === 'empty' ? [] : [{ ...books[2], title: 'Changed remotely' }, books[0]]
					)
				);
			await refresh;
			await frames();
			expect(document.querySelector('.rate-page__list.book-card-grid')).toBe(list);
			expect(Array.from(list.querySelectorAll('[data-testid="test-book-card"]'))).toEqual(nodes);
			Array.from(list.querySelectorAll('[data-testid="test-book-card"]')).forEach((node, index) => {
				expect(node).toBe(nodes[index]);
			});
			expect(nodes[0].textContent).toBe('Book 0');
			expect(window.scrollY).toBe(scroll);
			expect(insertFeedRequestRow).not.toHaveBeenCalled();
		}
	);

	it('clears the old account grid and ignores its late refresh after an account switch', async () => {
		const { controller, readLatest } = sharedFeed();
		rendered = render(RateFeedHarness, { controller });
		await frames();
		const oldRead = pendingRead();
		const nextRead = pendingRead();
		readLatest.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(nextRead.promise);
		const pending = controller.prepare(
			{ userId: 'test-user', accessToken: 'test-token' },
			{ force: true }
		);
		await frames();
		authStore.setSession({ access_token: 'next-token', user: { id: 'next-user' } } as Session);
		await frames();
		expect(document.querySelectorAll('[data-testid="test-book-card"]').length).toBe(0);
		oldRead.resolve(feedPayload());
		await pending;
		await frames();
		expect(document.querySelectorAll('[data-testid="test-book-card"]').length).toBe(0);
		nextRead.resolve(feedPayload([{ ...books[0], title: 'Next account book' }]));
		await frames();
		expect(document.querySelector('[data-testid="test-book-card"]')?.textContent).toBe(
			'Next account book'
		);
		expect(readLatest).toHaveBeenCalledTimes(3);
	});

	it('preserves mounted cards and avoids a duplicate fetch on a same-account token refresh', async () => {
		const { controller, readLatest } = sharedFeed();
		rendered = render(RateFeedHarness, { controller });
		await frames();
		const node = document.querySelector('[data-testid="test-book-card"]');
		authStore.setSession({ access_token: 'refreshed-token', user: { id: 'test-user' } } as Session);
		await frames();
		expect(document.querySelector('[data-testid="test-book-card"]')).toBe(node);
		expect(readLatest).toHaveBeenCalledTimes(1);
	});

	it('keeps the public Top 100 mounted when lazy anonymous sign-in claims the first guest action', async () => {
		const { controller, readLatest } = sharedFeed();
		authStore.setSession(null);
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ books, nextOffset: 50, hasMore: false })
		} as Response);
		rendered = render(RateFeedHarness, { controller });
		await frames();
		const node = document.querySelector('[data-testid="test-book-card"]');
		expect(node).not.toBeNull();
		document.querySelector<HTMLButtonElement>('.search-bar__trigger')!.click();
		await frames();
		const input = document.querySelector<HTMLInputElement>('.rate-search-overlay input')!;
		input.value = 'An author';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await frames();
		// The action that starts anonymous sign-in must keep its card available for undo.
		ratingsStore.hydrate([{ bookId: books[0].id, rating: 4 }]);
		authStore.setSession({
			access_token: 'guest-token',
			user: { id: 'guest-user', is_anonymous: true }
		} as Session);
		await frames();
		expect(document.querySelector('[data-testid="test-book-card"]')).toBe(node);
		expect(document.querySelector<HTMLInputElement>('.rate-search-overlay input')?.value).toBe(
			'An author'
		);
		expect(readLatest).not.toHaveBeenCalled();
		expect(insertFeedRequestRow).not.toHaveBeenCalled();
	});

	it('preserves an initial search deep link when authentication first attaches', async () => {
		const { controller } = sharedFeed();
		vi.mocked(afterNavigate).mockImplementationOnce((callback) => {
			callback({
				type: 'enter',
				to: { url: new URL('http://localhost/rate?q=An%20author') }
			} as Parameters<typeof callback>[0]);
		});
		rendered = render(RateFeedHarness, { controller });
		await frames(5);
		expect(document.querySelector<HTMLInputElement>('.rate-search-overlay input')?.value).toBe(
			'An author'
		);
	});

	it('reuses a pending initial generation request without inserting another job', async () => {
		const { controller, readLatest } = sharedFeed();
		readLatest.mockResolvedValue({
			...feedPayload([]),
			mode: 'feed_generation_pending',
			latest_request_id: 'pending-request',
			latest_request_status: 'processing'
		});
		vi.mocked(pollCuratedFeedRequest).mockResolvedValueOnce({ kind: 'completed', books });
		rendered = render(RateFeedHarness, { controller });
		await frames();
		expect(pollCuratedFeedRequest).toHaveBeenCalledWith(
			'pending-request',
			'test-token',
			expect.any(AbortSignal)
		);
		expect(insertFeedRequestRow).not.toHaveBeenCalled();
		expect(document.querySelectorAll('[data-testid="test-book-card"]').length).toBe(50);
	});

	it('retains the public fallback when an initial generated feed fails', async () => {
		const { controller, readLatest } = sharedFeed();
		readLatest.mockResolvedValue({
			...feedPayload([]),
			mode: 'feed_error',
			latest_request_status: 'failed'
		});
		vi.mocked(pollCuratedFeedRequest).mockResolvedValueOnce({ kind: 'failed' });
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ books, nextOffset: 50, hasMore: false })
		} as Response);
		rendered = render(RateFeedHarness, { controller });
		await frames();
		expect(document.querySelectorAll('[data-testid="test-book-card"]').length).toBe(50);
		expect(insertFeedRequestRow).toHaveBeenCalledTimes(1);
	});

	it('filters local interactions made while an initial read was pending before admitting its books', async () => {
		const { controller, readLatest } = sharedFeed();
		const read = pendingRead();
		readLatest.mockReturnValueOnce(read.promise);
		rendered = render(RateFeedHarness, { controller });
		await frames();
		ratingsStore.hydrate([{ bookId: books[0].id, rating: 4 }]);
		controller.invalidatePrepared();
		read.resolve(feedPayload());
		await frames();
		const nodes = Array.from(document.querySelectorAll('[data-testid="test-book-card"]'));
		expect(nodes.length).toBe(49);
		expect(nodes[0].textContent).toBe('Book 1');
	});

	it('keeps an admitted curated grid while library IDs have not arrived', async () => {
		const { controller } = sharedFeed();
		ratingsStore.hydrate([]);
		rendered = render(RateFeedHarness, { controller });
		await frames();
		const node = document.querySelector('[data-testid="test-book-card"]');
		for (const observer of observers.filter((o) => !o.disconnected)) observer.notify();
		await frames();
		expect(document.querySelector('[data-testid="test-book-card"]')).toBe(node);
		expect(fetch).not.toHaveBeenCalled();
		expect(insertFeedRequestRow).not.toHaveBeenCalled();
	});

	it('pauses pagination without replacing cards when a fresh server read is below threshold', async () => {
		visibleCards = 25;
		const { controller, readLatest } = sharedFeed();
		rendered = render(RateFeedHarness, { controller });
		await frames();
		const node = document.querySelector('[data-testid="test-book-card"]');
		readLatest.mockResolvedValue({
			...feedPayload([]),
			mode: 'below_threshold',
			interaction_count: 0,
			eligible_for_feed: false
		});
		await vi.advanceTimersByTimeAsync(2000);
		await frames();
		expect(readLatest).toHaveBeenCalledTimes(2);
		expect(document.querySelector('[data-testid="test-book-card"]')).toBe(node);
		expect(document.querySelectorAll('[data-testid="test-book-card"]').length).toBe(50);
		expect(fetch).not.toHaveBeenCalled();
		expect(insertFeedRequestRow).not.toHaveBeenCalled();
	});

	it.each(['reordered', 'empty', 'failed'] as const)(
		'admits persisted cards before the API resolves and preserves nodes/order/scroll through a 3-second %s refresh',
		async (outcome) => {
			const { controller, readLatest, cache } = cachedFeed();
			const read = pendingRead();
			readLatest.mockReturnValue(read.promise);
			rendered = render(RateFeedHarness, { controller });
			await frames(5);
			const list = document.querySelector<HTMLElement>('.rate-page__list.book-card-grid')!;
			const nodes = [...list.querySelectorAll('[data-testid="test-book-card"]')];
			expect(nodes).toHaveLength(50);
			expect(readLatest).toHaveBeenCalledOnce();
			expect(list.getAttribute('aria-busy')).not.toBe('true');
			list.style.minHeight = '4000px';
			window.scrollTo(0, 300);
			await frames();
			await vi.advanceTimersByTimeAsync(3000);
			await frames();
			expect(cache.read('test-user')?.fetchedAt).toBe(1000);
			const completion = controller.prepare({ userId: 'test-user', accessToken: 'test-token' });
			if (outcome === 'failed') read.reject(new Error('Outage'));
			else
				read.resolve(
					feedPayload(outcome === 'empty' ? [] : [{ ...books[2], title: 'New ordering' }, books[0]])
				);
			await completion.catch(() => undefined);
			await frames();
			const current = [...list.querySelectorAll('[data-testid="test-book-card"]')];
			expect(current).toHaveLength(nodes.length);
			current.forEach((node, index) => expect(node).toBe(nodes[index]));
			expect(nodes[0].textContent).toBe('Book 0');
			expect(window.scrollY).toBe(300);
			expect(document.querySelector('.rate-page__list[aria-busy="true"]')).toBeNull();
			expect(insertFeedRequestRow).not.toHaveBeenCalled();
			expect(pollCuratedFeedRequest).not.toHaveBeenCalled();
		}
	);

	it('filters cached ratings, bookmarks, and pending dismissals before the first card mounts', async () => {
		const { controller, readLatest } = cachedFeed();
		ratingsStore.hydrate([{ bookId: books[0].id, rating: 4 }]);
		planToReadStore.hydrate([books[1].id], new Map([[books[1].id, books[1].book_id]]));
		notInterestedStore.add(books[2].book_id);
		readLatest.mockReturnValue(pendingRead().promise);
		rendered = render(RateFeedHarness, { controller });
		await frames(5);
		const nodes = [...document.querySelectorAll('[data-testid="test-book-card"]')];
		expect(nodes).toHaveLength(47);
		expect(nodes[0].textContent).toBe('Book 3');
		expect(insertFeedRequestRow).not.toHaveBeenCalled();
	});

	it('uses the fresh path if every cached candidate is excluded', async () => {
		const { controller, readLatest } = cachedFeed();
		notInterestedStore.hydrate(books.map((book) => book.book_id));
		const fresh = { id: 'fresh-id', book_id: 'fresh-ulid', title: 'Fresh book', author: 'Author' };
		readLatest.mockResolvedValue(feedPayload([fresh]));
		rendered = render(RateFeedHarness, { controller });
		await frames(5);
		expect(document.querySelectorAll('[data-testid="test-book-card"]')).toHaveLength(1);
		expect(document.querySelector('[data-testid="test-book-card"]')?.textContent).toBe(
			'Fresh book'
		);
		expect(readLatest).toHaveBeenCalledOnce();
	});

	it('waits for fresh loading when complete interaction snapshots are unavailable', async () => {
		const { controller, readLatest } = cachedFeed();
		libraryLoads.reset();
		const read = pendingRead();
		readLatest.mockReturnValue(read.promise);
		rendered = render(RateFeedHarness, { controller });
		await frames(5);
		expect(document.querySelectorAll('[data-testid="test-book-card"]')).toHaveLength(0);
		read.resolve(feedPayload());
		await frames(5);
		expect(document.querySelectorAll('[data-testid="test-book-card"]')).toHaveLength(50);
	});

	it('appends fresh candidates after dwell without duplicating cached cards or generating a job', async () => {
		const { controller, readLatest } = cachedFeed();
		visibleCards = 25;
		const newBook = {
			id: 'new-id',
			book_id: 'new-ulid',
			title: 'New batch book',
			author: 'Author'
		};
		readLatest.mockResolvedValue(feedPayload([books[0], newBook]));
		rendered = render(RateFeedHarness, { controller });
		await frames(5);
		const first = document.querySelector('[data-testid="test-book-card"]');
		expect(document.querySelectorAll('[data-testid="test-book-card"]')).toHaveLength(50);
		await vi.advanceTimersByTimeAsync(2000);
		await frames(5);
		expect(document.querySelectorAll('[data-testid="test-book-card"]')).toHaveLength(51);
		expect(document.querySelector('[data-testid="test-book-card"]')).toBe(first);
		expect(insertFeedRequestRow).not.toHaveBeenCalled();
		expect(pollCuratedFeedRequest).not.toHaveBeenCalled();
	});

	it('does not use a persisted request pointer to poll or generate when live status fails', async () => {
		const { controller, readLatest } = cachedFeed();
		visibleCards = 25;
		readLatest.mockRejectedValue(new Error('Status unavailable'));
		rendered = render(RateFeedHarness, { controller });
		await frames(5);
		await vi.advanceTimersByTimeAsync(2000);
		await frames(5);
		expect(document.querySelectorAll('[data-testid="test-book-card"]')).toHaveLength(50);
		expect(readLatest).toHaveBeenCalledTimes(2);
		expect(document.querySelector('.error-banner__message')?.textContent).toBe(
			'Couldn’t load more books. Try again.'
		);
		expect(insertFeedRequestRow).not.toHaveBeenCalled();
		expect(pollCuratedFeedRequest).not.toHaveBeenCalled();
	});

	it('refreshes an in-memory candidate list when newly loaded interactions exclude every book', async () => {
		const { controller, readLatest } = cachedFeed();
		await controller.prepare({ userId: 'test-user', accessToken: 'test-token' });
		notInterestedStore.hydrate(books.map((book) => book.book_id));
		const fresh = { id: 'fresh-id', book_id: 'fresh-ulid', title: 'Fresh book', author: 'Author' };
		readLatest.mockResolvedValue(feedPayload([fresh]));
		rendered = render(RateFeedHarness, { controller });
		await frames(5);
		expect(document.querySelector('[data-testid="test-book-card"]')?.textContent).toBe(
			'Fresh book'
		);
		expect(readLatest).toHaveBeenCalledTimes(2);
	});

	it('restores a zero-interaction popular feed with its seed/offset without an initial popular read', async () => {
		const { controller, cache, readLatest } = cachedFeed();
		ratingsStore.hydrate([]);
		cache.write({
			version: 1,
			ownerId: 'test-user',
			fetchedAt: 1000,
			books,
			source: {
				kind: 'popular',
				requestId: null,
				seed: 'popular-seed',
				nextOffset: 50,
				hasMore: true
			}
		});
		readLatest.mockReturnValue(pendingRead().promise);
		rendered = render(RateFeedHarness, { controller });
		await frames(5);
		expect(document.querySelectorAll('[data-testid="test-book-card"]')).toHaveLength(50);
		expect(fetch).not.toHaveBeenCalled();
		for (const observer of observers.filter((o) => !o.disconnected)) observer.notify();
		await frames(5);
		expect(vi.mocked(fetch).mock.calls[0][0]).toContain('offset=50');
		expect(vi.mocked(fetch).mock.calls[0][0]).toContain('seed=popular-seed');
	});

	it('reuses a cached popular list during recent below-threshold validation across navigation', async () => {
		const { controller, cache, readLatest } = cachedFeed();
		ratingsStore.hydrate([]);
		cache.write({
			version: 1,
			ownerId: 'test-user',
			fetchedAt: 1000,
			books,
			source: {
				kind: 'popular',
				requestId: null,
				seed: 'popular-seed',
				nextOffset: 50,
				hasMore: false
			}
		});
		readLatest.mockResolvedValue({
			...feedPayload([]),
			mode: 'below_threshold',
			interaction_count: 0,
			ratings_count: 0,
			eligible_for_feed: false
		});
		rendered = render(RateFeedHarness, { controller });
		await frames(5);
		rendered.unmount();
		rendered = render(RateFeedHarness, { controller });
		await frames(5);
		expect(document.querySelectorAll('[data-testid="test-book-card"]')).toHaveLength(50);
		expect(readLatest).toHaveBeenCalledOnce();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('retains the existing public pagination retry after failure and banner dismissal, then appends successfully', async () => {
		const { controller, cache, readLatest } = cachedFeed();
		ratingsStore.hydrate([]);
		cache.write({
			version: 1,
			ownerId: 'test-user',
			fetchedAt: 1000,
			books,
			source: {
				kind: 'popular',
				requestId: null,
				seed: 'popular-seed',
				nextOffset: 50,
				hasMore: true
			}
		});
		readLatest.mockReturnValue(pendingRead().promise);
		vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
		rendered = render(RateFeedHarness, { controller });
		await frames(5);
		const first = document.querySelector('[data-testid="test-book-card"]');
		for (const observer of observers.filter((o) => !o.disconnected)) observer.notify();
		await frames(5);
		expect(document.querySelector('.error-banner__message')?.textContent).toBe(
			'Couldn’t load more books. Try again.'
		);
		expect(document.querySelector('.rate-page__feed-unlock-hint')).toBeNull();
		document.querySelector<HTMLButtonElement>('.error-banner__dismiss')!.click();
		await frames();
		const retry = document.querySelector<HTMLButtonElement>('.rate-page__load-more-card')!;
		expect(retry).not.toBeNull();
		expect(retry.disabled).toBe(false);
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({
				books: [{ id: 'next-id', book_id: 'next-ulid', title: 'Next book', author: 'Author' }],
				nextOffset: 51,
				hasMore: false
			})
		} as Response);
		retry.click();
		await frames(5);
		expect(document.querySelectorAll('[data-testid="test-book-card"]')).toHaveLength(51);
		expect(document.querySelector('[data-testid="test-book-card"]')).toBe(first);
		expect(vi.mocked(fetch).mock.calls[1][0]).toContain('offset=50');
		expect(document.querySelector('.rate-page__load-more-card')).toBeNull();
		expect(document.querySelector('.rate-page__feed-unlock-hint')).not.toBeNull();
	});
});
