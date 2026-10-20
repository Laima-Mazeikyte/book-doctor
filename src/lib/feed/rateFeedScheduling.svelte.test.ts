import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import type { Session } from '@supabase/supabase-js';
import RatePage from '../../routes/rate/+page.svelte';
import { authStore, markAuthInitReady } from '$lib/stores/auth';
import { ratingsStore } from '$lib/stores/ratings';
import { planToReadStore } from '$lib/stores/planToRead';
import { notInterestedStore } from '$lib/stores/notInterested';
import { insertFeedRequestRow, pollCuratedFeedRequest } from './warmCuratedFeed';

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

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
		vi.setSystemTime(10_000);
		visibleCards = 5;
		cardMeasurements = 0;
		observers = [];
		planToReadStore.reset();
		notInterestedStore.reset();
		ratingsStore.hydrate([{ bookId: 'already-rated', rating: 4 }]);
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
});
