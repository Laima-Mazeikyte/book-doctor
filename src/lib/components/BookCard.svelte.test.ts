import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page as browserPage } from 'vitest/browser';
import BookCard from './BookCard.svelte';
import '../../app.css';
import coverFixture from '$lib/assets/favicon.svg?url';
import { authStore, markAuthInitChecking, markAuthInitReady } from '$lib/stores/auth';

beforeEach(() => {
	authStore.setSession(null);
	markAuthInitReady();
});

const appPage = vi.hoisted(() => ({
	current: { state: {} as Record<string, unknown> }
}));

vi.mock('$app/stores', () => ({
	page: {
		subscribe(run: (value: typeof appPage.current & { url: URL }) => void) {
			run({
				...appPage.current,
				url: new URL('http://localhost/rate')
			});
			return () => undefined;
		}
	}
}));

vi.mock('$app/navigation', () => ({
	pushState(url: string, state: Record<string, unknown>) {
		appPage.current = { state };
		window.history.pushState(state, '', url);
	},
	replaceState(url: string, state: Record<string, unknown>) {
		appPage.current = { state };
		window.history.replaceState(state, '', url);
	},
	goto: vi.fn()
}));

const book = {
	id: 'uuid-book-1',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	title: 'A book',
	author: 'An author',
	summary: 'A complete summary'
};

it('waits for session restoration before enabling library actions', async () => {
	markAuthInitChecking();
	const rendered = render(BookCard, {
		props: { book, context: 'recommendations', onBookmark: vi.fn(), onNotInterested: vi.fn() }
	});
	await expect
		.element(rendered.getByRole('button', { name: 'Add to Bookmarks', exact: true }))
		.toBeDisabled();
	await expect
		.element(rendered.getByRole('button', { name: 'Not interested', exact: true }))
		.toBeDisabled();
	markAuthInitReady();
	await expect
		.element(rendered.getByRole('button', { name: 'Add to Bookmarks', exact: true }))
		.toBeEnabled();
	await expect
		.element(rendered.getByRole('button', { name: 'Not interested', exact: true }))
		.toBeEnabled();
	rendered.unmount();
});

it('opens the extracted canonical summary sheet without rate-only history', async () => {
	const historyLength = window.history.length;
	const rendered = render(BookCard, {
		props: {
			book,
			context: 'recommendations',
			dimensionMatches: [{ dimension_key: 'spice', candidate_raw_score: 0 }],
			onRate: vi.fn(),
			onRemoveRating: vi.fn()
		}
	});

	await rendered
		.getByRole('button', { name: 'A book by An author. See summary', exact: true })
		.first()
		.click();
	await expect.element(rendered.getByTestId('book-summary-sheet')).toBeVisible();
	await expect.element(rendered.getByRole('heading', { name: 'A book' })).toBeVisible();
	expect(document.querySelectorAll('.recommendation-dimension-matches')).toHaveLength(2);
	await expect
		.element(
			rendered
				.getByTestId('book-summary-sheet')
				.getByText('Matches your interest in gentle relationships', { exact: true })
		)
		.toBeVisible();
	expect(window.history.length).toBe(historyLength);
	expect(window.history.state?.bookSummarySheet).toBeUndefined();
	rendered.unmount();
});

it('strips its owned shallow marker when a rate card is removed', async () => {
	appPage.current = { state: {} };
	const historyLength = window.history.length;
	const rendered = render(BookCard, {
		props: {
			book,
			context: 'rate',
			onRate: vi.fn(),
			onRemoveRating: vi.fn()
		}
	});

	await rendered
		.getByRole('button', { name: 'A book by An author. See summary', exact: true })
		.first()
		.click();
	await expect.element(rendered.getByTestId('book-summary-sheet')).toBeVisible();
	expect(window.history.length).toBe(historyLength + 1);
	expect(window.history.state?.bookSummarySheet).toEqual({
		ownerId: expect.any(String),
		bookUlid: book.book_id
	});

	rendered.unmount();
	await expect.poll(() => window.history.state?.bookSummarySheet).toBeUndefined();
	expect(window.history.length).toBe(historyLength + 1);

	window.history.back();
	appPage.current = { state: {} };
});

it('keeps translucent actions responsive without filters or duplicate cover images', async () => {
	await browserPage.viewport(1280, 900);
	const rendered = render(BookCard, {
		props: {
			book: { ...book, coverUrl: coverFixture },
			context: 'recommendations',
			coverPriority: 'lazy',
			onBookmark: vi.fn(),
			onNotInterested: vi.fn()
		}
	});
	const cover = rendered.container.querySelector<HTMLImageElement>('img')!;
	expect(rendered.container.querySelectorAll('img')).toHaveLength(1);
	expect(rendered.container.querySelectorAll('canvas')).toHaveLength(0);
	expect(cover.loading).toBe('lazy');
	for (const width of [180, 280, 400]) {
		rendered.container.style.width = width + 'px';
		await expect
			.element(rendered.getByRole('button', { name: 'Add to Bookmarks', exact: true }))
			.toBeVisible();
	}
	const summary = rendered
		.getByRole('button', {
			name: 'A book by An author. See summary',
			exact: true
		})
		.last();
	await summary.hover();
	await expect.poll(() => summary.element().getBoundingClientRect().width).toBeGreaterThan(80);
	for (const element of rendered.container.querySelectorAll(
		'.book-card__media-inner, .book-card__media-inner *'
	)) {
		const style = getComputedStyle(element);
		expect(style.filter).toBe('none');
		expect(style.backdropFilter).toBe('none');
	}
	for (const action of rendered.container.querySelectorAll('.book-card__action')) {
		expect(getComputedStyle(action).backgroundImage).toBe('none');
	}
	await summary.click();
	await expect.element(rendered.getByTestId('book-summary-sheet')).toBeVisible();
	rendered.unmount();
});

it('keeps translucent actions and callbacks working when the cover fails', async () => {
	const onBookmark = vi.fn();
	const onNotInterested = vi.fn();
	const rendered = render(BookCard, {
		props: {
			book: { ...book, coverUrl: coverFixture },
			context: 'recommendations',
			onBookmark,
			onNotInterested
		}
	});
	rendered.container.style.width = '280px';
	rendered.container.querySelector('.book-card__cover-hit img')!.dispatchEvent(new Event('error'));
	await expect.poll(() => rendered.container.querySelectorAll('img').length).toBe(0);
	expect(
		getComputedStyle(rendered.container.querySelector('.book-card__action')!).backgroundImage
	).toBe('none');
	await rendered.getByRole('button', { name: 'Add to Bookmarks', exact: true }).click();
	expect(onBookmark).toHaveBeenCalledWith(book.id);
	await rendered.getByRole('button', { name: 'Not interested', exact: true }).click();
	expect(onNotInterested).toHaveBeenCalledWith(book.id);
	await rendered.rerender({ bookmarked: true, notInterested: true });
	expect(rendered.container.querySelectorAll('canvas')).toHaveLength(0);
	expect(
		rendered.container.querySelector('.book-card__action--saved')?.getAttribute('aria-pressed')
	).toBe('true');
	await rendered
		.getByRole('button', { name: 'A book by An author. See summary', exact: true })
		.last()
		.click();
	await expect.element(rendered.getByTestId('book-summary-sheet')).toBeVisible();
	rendered.unmount();
});

it('keeps selected actions distinct from the translucent surface', async () => {
	const rendered = render(BookCard, {
		props: {
			book: { ...book, coverUrl: coverFixture },
			context: 'recommendations',
			bookmarked: true,
			onBookmark: vi.fn()
		}
	});
	rendered.container.style.width = '280px';
	const bookmark = rendered.container.querySelector('.book-card__cover-actions--tl button')!;
	const selectedBackground = getComputedStyle(bookmark).backgroundColor;
	await rendered.rerender({ bookmarked: false });
	await expect.poll(() => getComputedStyle(bookmark).backgroundColor).not.toBe(selectedBackground);
	rendered.unmount();
});
