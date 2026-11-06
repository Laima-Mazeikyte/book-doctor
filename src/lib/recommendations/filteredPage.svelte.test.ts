import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { page as browserPage, userEvent } from 'vitest/browser';
import '../../app.css';
import type { Session } from '@supabase/supabase-js';
import FilteredPage from '../../routes/discover/+page.svelte';
import { pageState } from './test-support/filteredPageState.svelte';
import { authStore, markAuthInitReady } from '$lib/stores/auth';
import { librarySaves } from '$lib/stores/librarySaves';
import { libraryLoads } from '$lib/stores/libraryLoads';
import { ratingsStore } from '$lib/stores/ratings';
import { draftFromFilters, buildRecommendationFilters } from './filteredRecommendations';
import { RequestTimeoutError } from '$lib/requests/timeout';

const mocks = vi.hoisted(() => ({
	from: vi.fn(),
	insert: vi.fn(),
	insertBody: undefined as unknown,
	read: vi.fn(),
	recent: vi.fn(),
	books: vi.fn(),
	bookBySlug: vi.fn(),
	search: vi.fn(),
	fetch: vi.fn(),
	goto: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn()
}));
vi.mock('$app/state', async () => ({
	page: (await import('./test-support/filteredPageState.svelte')).pageState,
	navigating: { to: null }
}));
vi.mock('$app/navigation', () => ({
	goto: mocks.goto,
	pushState: mocks.pushState,
	replaceState: mocks.replaceState
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/supabase', () => ({ getSupabase: () => ({ from: mocks.from }) }));
vi.mock('$lib/recommendations/startingBooks', () => ({
	loadStartingBooks: mocks.books,
	loadStartingBookBySlug: mocks.bookBySlug
}));
vi.mock('$lib/search', () => ({ searchBooks: mocks.search }));
vi.mock('$lib/recommendations/fetchRecommendations', () => ({ fetchRecommendations: mocks.fetch }));
vi.mock('$lib/recommendations/authorOptions', () => ({
	loadAuthorOptions: vi.fn().mockResolvedValue([]),
	searchAuthorOptions: vi.fn().mockReturnValue([])
}));
vi.mock('$lib/stores/recommendationsCount', () => ({
	refreshRecommendationsCountFromApi: vi.fn()
}));
vi.mock('$lib/components/BookCard.svelte', async () => ({
	default: (await import('./test-support/TestBookCard.svelte')).default
}));

const seed = '01KR2ADTFG9DJ85AS30MZFHJG6';
const other = '01KR2ADTC0FSRR230FSXKVW4VN';
const slug = 'the-hunger-games-suzanne-collins';
const otherSlug = 'agenda-21-glenn-beck';
const book = {
	book_id: seed,
	title: 'The Hunger Games',
	author: 'Suzanne Collins',
	genres: ['Fantasy', 'Urban Fantasy'],
	keywords: ['Found Family', 'Rebels']
};
const filters = { seed_book_id: seed, relative_dimensions: { violence: -0.15, pace: 0.1 } };
const historyStack: App.PageState[] = [];

function signIn(userId = 'reader', token = 'token') {
	librarySaves.activateOwner(userId);
	libraryLoads.markSnapshot(userId, ['ratings', 'bookmarks', 'dismissals']);
	authStore.setSession({ access_token: token, user: { id: userId } } as Session);
}

beforeEach(async () => {
	await browserPage.viewport(1280, 900);
	vi.clearAllMocks();
	pageState.state = {};
	historyStack.length = 0;
	mocks.pushState.mockImplementation((_url: string, state: App.PageState) => {
		historyStack.push(pageState.state);
		pageState.state = state;
	});
	mocks.replaceState.mockImplementation((_url: string, state: App.PageState) => {
		pageState.state = state;
	});
	vi.spyOn(window.history, 'back').mockImplementation(() => {
		pageState.state = historyStack.pop() ?? {};
	});
	pageState.url = new URL(`http://localhost/discover?from=${slug}&change=less-violence`);
	librarySaves.discard();
	librarySaves.activateOwner(null);
	libraryLoads.reset();
	ratingsStore.reset();
	authStore.setSession(null);
	markAuthInitReady();
	signIn();
	mocks.books.mockImplementation(async (ids: string[]) =>
		ids.map((id) => ({ ...book, book_id: id }))
	);
	mocks.bookBySlug.mockImplementation(async (value: string) => ({
		...book,
		slug: value,
		book_id: value === otherSlug ? other : seed
	}));
	mocks.search.mockResolvedValue({ books: [{ ...book, book_id: other, title: 'Another Book' }] });
	mocks.recent.mockResolvedValue({ data: [], error: null });
	mocks.read.mockResolvedValue({
		data: { id: 42, public_id: 'SavedAb1', filters, status: 'completed', result_count: 0 },
		error: null
	});
	mocks.insert.mockResolvedValue({ data: { id: 43, public_id: 'NewRunA1' }, error: null });
	mocks.fetch.mockResolvedValue({
		books: [],
		likedBookPrecedentsByBookId: {},
		authorRelationshipAuthorsByBookId: {},
		dimensionMatchSnapshotsByBookId: {}
	});
	mocks.from.mockImplementation(() => {
		let writing = false;
		const query = {
			select: vi.fn(() => query),
			eq: vi.fn(() => query),
			not: vi.fn(() => query),
			order: vi.fn(() => query),
			abortSignal: vi.fn(() => query),
			limit: mocks.recent,
			insert: vi.fn((body) => {
				writing = true;
				mocks.insertBody = body;
				return query;
			}),
			single: () => (writing ? mocks.insert() : mocks.read()),
			maybeSingle: mocks.read
		};
		return query;
	});
	mocks.goto.mockImplementation(async (path: string) => {
		pageState.state = {};
		pageState.url = new URL(path, 'http://localhost');
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it('opens from a book without generating, and submits the seed and modifier with zero ratings', async () => {
	const screen = render(FilteredPage);
	await expect.element(screen.getByText(book.title, { exact: true })).toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Less violence', exact: true }))
		.toHaveAttribute('aria-pressed', 'true');
	expect(mocks.insert).not.toHaveBeenCalled();
	expect(mocks.bookBySlug).toHaveBeenCalledTimes(1);
	expect(mocks.books).not.toHaveBeenCalled();
	const submit = screen.getByRole('button', { name: 'Find books', exact: true });
	await expect.element(submit).toBeEnabled();
	await submit.click();
	await expect.poll(() => mocks.insert.mock.calls.length).toBe(1);
	expect(mocks.insertBody).toEqual({
		user_id: 'reader',
		filters: { seed_book_id: seed, relative_dimensions: { violence: -0.15 } }
	});
	await expect.poll(() => mocks.goto.mock.calls.length).toBe(1);
	await expect.poll(() => document.querySelector('dialog')).toBeNull();
	pageState.url = new URL(`http://localhost/discover?from=${slug}`);
	await expect.element(screen.getByRole('dialog', { name: 'Refine your search' })).toBeVisible();
	await screen.getByRole('button', { name: 'Close filters', exact: true }).click();
	await expect.poll(() => document.querySelector('dialog')).toBeNull();
	expect(document.activeElement).toBe(
		screen.getByRole('button', { name: 'Filters', exact: true }).element()
	);
	screen.unmount();
});

it('ignores a late slug resolution after navigating to another starting book', async () => {
	let finishFirst!: (value: typeof book) => void;
	mocks.bookBySlug.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finishFirst = resolve;
			})
	);
	const screen = render(FilteredPage);
	await expect.element(screen.getByText('Loading starting book…', { exact: true })).toBeVisible();
	pageState.url = new URL(`http://localhost/discover?from=${otherSlug}`);
	await expect.element(screen.getByText(book.title, { exact: true })).toBeVisible();
	finishFirst(book);
	await tick();
	await expect.poll(() => document.querySelectorAll('dialog').length).toBe(1);
	await screen.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => mocks.insert.mock.calls.length).toBe(1);
	expect(mocks.insertBody).toEqual({ user_id: 'reader', filters: { seed_book_id: other } });
	screen.unmount();
});

it('restores exact modifiers for history and retry, including the introspective direction', async () => {
	pageState.url = new URL('http://localhost/discover?search=42');
	mocks.read.mockResolvedValue({
		data: {
			id: 42,
			public_id: 'SavedAb1',
			filters,
			status: 'failed',
			error_code: 'recommendation_failed'
		},
		error: null
	});
	const screen = render(FilteredPage);
	await screen.getByRole('button', { name: 'Review filters and try again', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'More introspective', exact: true }))
		.toHaveAttribute('aria-pressed', 'true');
	await screen.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => mocks.insert.mock.calls.length).toBe(1);
	expect(mocks.insertBody).toEqual({ user_id: 'reader', filters });
	expect(buildRecommendationFilters(draftFromFilters(filters))).toEqual(filters);
	screen.unmount();
});

it('clears relative changes when removing or replacing the source and keeps ordinary eligibility', async () => {
	const screen = render(FilteredPage);
	await expect.element(screen.getByText(book.title, { exact: true })).toBeVisible();
	await screen.getByRole('button', { name: 'Remove', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Find books', exact: true }))
		.toBeDisabled();
	await screen
		.getByRole('combobox', { name: 'Starting book (optional)', exact: true })
		.fill('Another');
	await expect
		.element(screen.getByRole('option', { name: 'Another Book Suzanne Collins', exact: true }))
		.toBeVisible();
	await userEvent.keyboard('{Enter}');
	expect(mocks.insert).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => mocks.insert.mock.calls.length).toBe(1);
	expect(mocks.insertBody).toEqual({ user_id: 'reader', filters: { seed_book_id: other } });
	screen.unmount();
});

it('uses request status before reading results and preserves backend order', async () => {
	vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
	pageState.url = new URL('http://localhost/discover?search=42');
	mocks.read
		.mockResolvedValueOnce({
			data: { id: 42, public_id: 'SavedAb1', filters, status: 'processing', result_count: null },
			error: null
		})
		.mockResolvedValue({
			data: { id: 42, public_id: 'SavedAb1', filters, status: 'completed', result_count: 2 },
			error: null
		});
	mocks.fetch.mockResolvedValue({
		books: [
			{ id: 'b', book_id: other, title: 'First ranked', author: 'Author' },
			{ id: 'a', book_id: seed, title: 'Second ranked', author: 'Author' }
		],
		likedBookPrecedentsByBookId: {},
		authorRelationshipAuthorsByBookId: {},
		dimensionMatchSnapshotsByBookId: {}
	});
	const screen = render(FilteredPage);
	await tick();
	expect(mocks.fetch).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Filters', exact: true }).click();
	await screen.getByRole('button', { name: 'More violence', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Find books', exact: true }))
		.toBeDisabled();
	await vi.advanceTimersByTimeAsync(2000);
	await expect.poll(() => mocks.fetch.mock.calls.length).toBe(1);
	await expect
		.element(screen.getByRole('button', { name: 'Find books', exact: true }))
		.toBeEnabled();
	await expect
		.element(screen.getByRole('button', { name: 'More violence', exact: true }))
		.toHaveAttribute('aria-pressed', 'true');
	await screen.getByRole('button', { name: 'Close filters', exact: true }).click();
	expect(mocks.fetch).toHaveBeenCalledWith('token', '42', { includeRated: true });
	await expect.element(screen.getByText('First ranked', { exact: true })).toBeVisible();
	expect(
		[...document.querySelectorAll('[data-testid="test-book-card"]')].map((node) => node.textContent)
	).toEqual(['First ranked', 'Second ranked']);
	screen.unmount();
});

it('keeps public choices through sign-in, but ignores a previous account submission after account change', async () => {
	authStore.setSession(null);
	const screen = render(FilteredPage);
	await expect.element(screen.getByText(book.title, { exact: true })).toBeVisible();
	await screen.getByRole('button', { name: 'More introspective', exact: true }).click();
	signIn();
	const submit = screen.getByRole('button', { name: 'Find books', exact: true });
	await expect.element(submit).toBeEnabled();
	let resolveInsert!: (value: unknown) => void;
	mocks.insert.mockReturnValue(
		new Promise((resolve) => {
			resolveInsert = resolve;
		})
	);
	await submit.click();
	await expect.poll(() => mocks.insert.mock.calls.length).toBe(1);
	expect(mocks.insertBody).toEqual({
		user_id: 'reader',
		filters: { seed_book_id: seed, relative_dimensions: { violence: -0.15, pace: 0.15 } }
	});
	signIn('other-reader', 'other-token');
	await tick();
	resolveInsert({ data: { id: 99, public_id: 'NewRunB2' }, error: null });
	await tick();
	await new Promise(requestAnimationFrame);
	expect(mocks.goto).not.toHaveBeenCalled();
	screen.unmount();
});

it('supports a ratings-based search with an optional starting book through the same editor', async () => {
	pageState.url = new URL('http://localhost/discover');
	ratingsStore.hydrate(
		Array.from({ length: 10 }, (_, index) => ({ bookId: `rated-${index}`, rating: 4 }))
	);
	const screen = render(FilteredPage);
	await expect.element(screen.getByRole('dialog', { name: 'Refine your search' })).toBeVisible();
	await screen.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.element(screen.getByRole('alert')).toHaveTextContent('Choose at least one filter.');
	expect(mocks.insert).not.toHaveBeenCalled();
	await screen.getByRole('radio', { name: 'Fiction', exact: true }).click();
	await screen.getByRole('button', { name: 'Require Fantasy', exact: true }).click();
	await screen.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => mocks.insert.mock.calls.length).toBe(1);
	expect(mocks.insertBody).toEqual({
		user_id: 'reader',
		filters: { genres: { all_of: ['Fantasy'] }, type: ['Fiction'] }
	});
	screen.unmount();
});

it('opens an editor on first visit without generating and keeps draft choices when it closes', async () => {
	const screen = render(FilteredPage);
	await expect.element(screen.getByRole('dialog', { name: 'Refine your search' })).toBeVisible();
	await screen.getByRole('button', { name: 'More introspective', exact: true }).click();
	await screen.getByRole('button', { name: 'Close filters' }).click();
	await expect.poll(() => document.querySelector('dialog')).toBeNull();
	expect(document.activeElement).toBe(
		screen.getByRole('button', { name: 'Filters', exact: true }).element()
	);
	await screen.getByRole('button', { name: 'Filters', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'More introspective', exact: true }))
		.toHaveAttribute('aria-pressed', 'true');
	expect(mocks.insert).not.toHaveBeenCalled();
	screen.unmount();
});

it('keeps original applied criteria separate from unapplied drafts and returns focus after submission', async () => {
	pageState.url = new URL('http://localhost/discover?search=42');
	const screen = render(FilteredPage);
	await expect.element(screen.getByText('Search filters', { exact: true })).toBeVisible();
	expect(document.querySelector('dialog')).toBeNull();
	const applied = document.querySelector('.filtered-page__applied')!;
	expect(applied.textContent).toContain('Less violence');
	await screen.getByRole('button', { name: 'Filters', exact: true }).click();
	await screen.getByRole('button', { name: 'More violence', exact: true }).click();
	await screen.getByRole('button', { name: 'Close filters' }).click();
	await expect
		.element(screen.getByText('Your changes haven’t been applied.', { exact: true }))
		.toBeVisible();
	expect(applied.textContent).toContain('Less violence');
	expect(applied.textContent).not.toContain('More violence');
	await screen.getByRole('button', { name: 'Review changes', exact: true }).click();
	await screen.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => mocks.insert.mock.calls.length).toBe(1);
	await expect.poll(() => document.querySelector('dialog')).toBeNull();
	expect(document.activeElement).toBe(
		screen.getByRole('heading', { name: 'Your matches', exact: true }).element()
	);
	expect(mocks.insertBody).toEqual({
		user_id: 'reader',
		filters: { ...filters, relative_dimensions: { violence: 0.15, pace: 0.1 } }
	});
	screen.unmount();
});

it('blocks editing while saved filters load, and restores them after a failed initial read', async () => {
	vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
	pageState.url = new URL('http://localhost/discover?search=42');
	mocks.read.mockResolvedValueOnce({ data: null, error: new Error('offline') });
	const screen = render(FilteredPage);
	await screen.getByRole('button', { name: 'Filters', exact: true }).click();
	await expect.element(screen.getByText('Loading saved filters…', { exact: true })).toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Find books', exact: true }))
		.toBeDisabled();
	expect(document.querySelector('#starting-book-search')).toBeNull();
	await vi.advanceTimersByTimeAsync(5000);
	await expect
		.element(screen.getByRole('button', { name: 'Less violence', exact: true }))
		.toHaveAttribute('aria-pressed', 'true');
	await expect
		.element(screen.getByRole('button', { name: 'More introspective', exact: true }))
		.toHaveAttribute('aria-pressed', 'true');
	await expect
		.element(screen.getByRole('button', { name: 'Find books', exact: true }))
		.toBeEnabled();
	expect(mocks.insert).not.toHaveBeenCalled();
	screen.unmount();
});

it('contains keyboard focus in nested tag choices, restores the opener, and retains the body lock', async () => {
	const previousOverflow = document.body.style.overflow;
	const screen = render(FilteredPage);
	await expect.element(screen.getByRole('dialog', { name: 'Refine your search' })).toBeVisible();
	await screen.getByText('Genres, themes & tropes', { exact: true }).click();
	const browse = screen.getByRole('button', { name: 'Browse all', exact: true }).first();
	await browse.click();
	await expect
		.element(screen.getByRole('dialog', { name: 'Choose genres', exact: true }))
		.toBeVisible();
	const nested = screen.getByRole('dialog', { name: 'Choose genres', exact: true }).element();
	const done = screen
		.getByRole('button', { name: 'Done', exact: true })
		.element() as HTMLButtonElement;
	done.focus();
	await userEvent.keyboard('{Tab}');
	expect(nested.contains(document.activeElement)).toBe(true);
	expect(document.activeElement).not.toBe(done);
	await userEvent.keyboard('{Escape}');
	await expect.poll(() => document.querySelectorAll('dialog').length).toBe(1);
	expect(document.activeElement).toBe(browse.element());
	expect(document.body.style.overflow).toBe('hidden');
	const summary = document.querySelector('.filter-fields__group > summary') as HTMLElement;
	summary.focus();
	await userEvent.keyboard('{Tab}');
	expect(document.activeElement).not.toBe(
		screen.getByRole('button', { name: 'Close filters' }).element()
	);
	await userEvent.keyboard('{Escape}');
	await expect.poll(() => document.querySelectorAll('dialog').length).toBe(0);
	expect(document.body.style.overflow).toBe(previousOverflow);
	expect(mocks.insert).not.toHaveBeenCalled();
	screen.unmount();
});

it('releases scroll lock if navigation removes a panel and its nested tag dialog together', async () => {
	const previousOverflow = document.body.style.overflow;
	const screen = render(FilteredPage);
	await expect.element(screen.getByRole('dialog', { name: 'Refine your search' })).toBeVisible();
	await screen.getByText('Genres, themes & tropes', { exact: true }).click();
	await screen.getByRole('button', { name: 'Browse all', exact: true }).first().click();
	await expect.element(screen.getByRole('dialog', { name: 'Choose genres' })).toBeVisible();
	pageState.url = new URL('http://localhost/discover?search=42');
	await expect.poll(() => document.querySelectorAll('dialog').length).toBe(0);
	expect(document.body.style.overflow).toBe(previousOverflow);
	screen.unmount();
});

it('keeps an uncertain submission explained and locked even after clearing or closing the editor', async () => {
	mocks.insert.mockRejectedValue(new RequestTimeoutError());
	const screen = render(FilteredPage);
	await screen.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect
		.element(screen.getByRole('alert'))
		.toHaveTextContent(/could not confirm whether this search started/);
	await screen.getByRole('button', { name: 'Clear filters', exact: true }).click();
	await expect
		.element(screen.getByRole('alert'))
		.toHaveTextContent(/could not confirm whether this search started/);
	await expect
		.element(screen.getByRole('button', { name: 'Find books', exact: true }))
		.toBeDisabled();
	await screen.getByRole('button', { name: 'Close filters', exact: true }).click();
	await expect
		.element(screen.getByRole('alert'))
		.toHaveTextContent(/could not confirm whether this search started/);
	expect(mocks.insert).toHaveBeenCalledTimes(1);
	screen.unmount();
});

it('uses exact source tags for exclusion and supports adding required tags without changing other labels', async () => {
	const screen = render(FilteredPage);
	await expect.element(screen.getByText(book.title, { exact: true })).toBeVisible();
	await screen.getByText('Genres, themes & tropes', { exact: true }).click();
	await screen.getByRole('button', { name: 'Exclude Fantasy', exact: true }).click();
	expect(document.querySelector('.filter-fields__group')?.hasAttribute('open')).toBe(true);
	await expect
		.element(screen.getByRole('button', { name: 'Exclude Urban Fantasy', exact: true }))
		.toBeVisible();
	await screen.getByRole('button', { name: 'Exclude Found Family', exact: true }).click();
	await screen.getByRole('button', { name: 'Browse all', exact: true }).first().click();
	await screen.getByRole('searchbox', { name: 'Search genres', exact: true }).fill('Romance');
	await screen.getByRole('checkbox', { name: 'Romance', exact: true }).click();
	await screen.getByRole('button', { name: 'Done', exact: true }).click();
	expect(mocks.insert).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => mocks.insert.mock.calls.length).toBe(1);
	expect(mocks.insertBody).toEqual({
		user_id: 'reader',
		filters: {
			seed_book_id: seed,
			relative_dimensions: { violence: -0.15 },
			genres: { all_of: ['Romance'], none_of: ['Fantasy'] },
			keywords: { none_of: ['Found Family'] }
		}
	});
	screen.unmount();
});

it('restores all three tag operators and resubmits them together unchanged', async () => {
	pageState.url = new URL('http://localhost/discover?search=42');
	const saved = {
		seed_book_id: seed,
		genres: { all_of: ['Fantasy'], any_of: ['Romance', 'Mystery'], none_of: ['Urban Fantasy'] },
		keywords: { all_of: ['Rebels'], none_of: ['Found Family'] }
	};
	mocks.read.mockResolvedValue({
		data: {
			id: 42,
			public_id: 'SavedAb1',
			filters: saved,
			status: 'failed',
			error_code: 'recommendation_failed'
		},
		error: null
	});
	const screen = render(FilteredPage);
	await screen.getByRole('button', { name: 'Review filters and try again', exact: true }).click();
	await screen.getByText('Genres, themes & tropes', { exact: true }).click();
	await expect
		.element(screen.getByRole('group', { name: 'Genres: Require all', exact: true }))
		.toHaveTextContent('Fantasy');
	await expect
		.element(screen.getByRole('group', { name: 'Genres: At least one', exact: true }))
		.toHaveTextContent('Romance');
	await expect
		.element(screen.getByRole('group', { name: 'Genres: Exclude', exact: true }))
		.toHaveTextContent('Urban Fantasy');
	await screen.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => mocks.insert.mock.calls.length).toBe(1);
	expect(mocks.insertBody).toEqual({ user_id: 'reader', filters: saved });
	screen.unmount();
});

it('keeps empty results unchanged until an explicit recovery and submits only the applied source once', async () => {
	pageState.url = new URL('http://localhost/discover?search=42');
	const saved = {
		...filters,
		genres: { all_of: ['Fantasy'], none_of: ['Romance'] },
		keywords: { none_of: ['Found Family'] },
		pages: { max: 100 }
	};
	mocks.read.mockImplementation(async () => ({
		data: {
			id: mocks.insert.mock.calls.length ? 43 : 42,
			public_id: mocks.insert.mock.calls.length ? 'NewRunA1' : 'SavedAb1',
			filters: mocks.insert.mock.calls.length ? { seed_book_id: seed } : saved,
			status: 'completed',
			result_count: 0
		},
		error: null
	}));
	const screen = render(FilteredPage);
	await expect
		.element(screen.getByRole('button', { name: 'Use starting book only', exact: true }))
		.toBeVisible();
	expect(mocks.insert).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Adjust filters', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Less violence', exact: true }))
		.toHaveAttribute('aria-pressed', 'true');
	expect(mocks.insert).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Close filters', exact: true }).click();
	const fallback = screen
		.getByRole('button', { name: 'Use starting book only', exact: true })
		.element() as HTMLButtonElement;
	fallback.click();
	fallback.click();
	await expect.poll(() => mocks.insert.mock.calls.length).toBe(1);
	expect(mocks.insertBody).toEqual({ user_id: 'reader', filters: { seed_book_id: seed } });
	await expect
		.element(screen.getByRole('button', { name: 'Choose another starting book', exact: true }))
		.toBeVisible();
	await screen.getByRole('button', { name: 'Choose another starting book', exact: true }).click();
	await expect
		.element(screen.getByRole('combobox', { name: 'Starting book (optional)', exact: true }))
		.toBeVisible();
	expect(document.activeElement).toBe(
		screen.getByRole('combobox', { name: 'Starting book (optional)', exact: true }).element()
	);
	expect(mocks.insert).toHaveBeenCalledTimes(1);
	screen.unmount();
});

it('does not submit an unresolved slug and permits an explicit retry after a failed lookup', async () => {
	ratingsStore.hydrate(
		Array.from({ length: 10 }, (_, index) => ({ bookId: `rated-${index}`, rating: 4 }))
	);
	mocks.bookBySlug.mockResolvedValue(null);
	const screen = render(FilteredPage);
	await expect
		.element(screen.getByRole('button', { name: 'Find books', exact: true }))
		.toBeDisabled();
	await expect
		.element(screen.getByText('This starting book is unavailable. Choose another book.').first())
		.toBeVisible();
	expect(mocks.insert).not.toHaveBeenCalled();
	mocks.bookBySlug.mockRejectedValue(new Error('Temporary catalog error'));
	pageState.url = new URL(`http://localhost/discover?from=${otherSlug}`);
	await expect
		.element(
			screen.getByText('Could not load the starting book. Try again or choose another.', {
				exact: true
			})
		)
		.toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Find books', exact: true }))
		.toBeDisabled();
	mocks.bookBySlug.mockResolvedValue({ ...book, book_id: other, slug: otherSlug });
	await screen.getByRole('button', { name: 'Try again', exact: true }).click();
	await expect.element(screen.getByText(book.title, { exact: true })).toBeVisible();
	await screen.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => mocks.insert.mock.calls.length).toBe(1);
	expect(mocks.insertBody).toEqual({ user_id: 'reader', filters: { seed_book_id: other } });
	screen.unmount();
});

it('refreshes history after an uncertain write, exposes retry, and keeps the write guard', async () => {
	const screen = render(FilteredPage);
	await expect.element(screen.getByText(book.title, { exact: true })).toBeVisible();
	mocks.recent.mockResolvedValue({ data: null, error: new Error('History unavailable') });
	mocks.insert.mockRejectedValue(new RequestTimeoutError());
	await screen.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => mocks.recent.mock.calls.length).toBeGreaterThanOrEqual(2);
	await screen.getByRole('button', { name: 'View recent searches', exact: true }).click();
	await expect
		.element(screen.getByText('Could not load recent searches. Please try again.', { exact: true }))
		.toBeVisible();
	await expect.poll(() => document.querySelector('dialog')).toBeNull();
	expect(document.activeElement?.textContent).toBe('Recent searches');
	mocks.recent.mockResolvedValue({
		data: [
			{
				id: 99,
				public_id: 'NewRunB2',
				filters: { seed_book_id: seed },
				status: 'processing',
				created_at: null
			}
		],
		error: null
	});
	await screen.getByRole('button', { name: 'Refresh recent searches', exact: true }).click();
	await expect
		.element(screen.getByRole('link', { name: /Starting from The Hunger Games/ }))
		.toBeVisible();
	await screen.getByRole('button', { name: 'Filters', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Find books', exact: true }))
		.toBeDisabled();
	expect(mocks.insert).toHaveBeenCalledTimes(1);
	screen.unmount();
});

it('does not offer a source-only fallback for an ordinary empty filtered search', async () => {
	pageState.url = new URL('http://localhost/discover?search=42');
	mocks.read.mockResolvedValue({
		data: {
			id: 42,
			public_id: 'SavedAb1',
			filters: { genres: { none_of: ['Fantasy'] } },
			status: 'completed',
			result_count: 0
		},
		error: null
	});
	const screen = render(FilteredPage);
	await expect
		.element(screen.getByRole('button', { name: 'Adjust filters', exact: true }))
		.toBeVisible();
	expect(document.body.textContent).not.toContain('Use starting book only');
	expect(mocks.insert).not.toHaveBeenCalled();
	screen.unmount();
});
