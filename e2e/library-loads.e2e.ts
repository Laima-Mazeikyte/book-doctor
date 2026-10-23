import { expect, test, type Page, type Route } from '@playwright/test';
import { loadEnv } from 'vite';

test.setTimeout(60_000);
const base = 'http://127.0.0.1:4173';
const env = loadEnv('development', process.cwd(), '');
const supabaseUrl = env.PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
const authKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const books = Array.from({ length: 16 }, (_, index) => ({
	id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
	book_id: `01${String(index + 1).padStart(24, '0')}`,
	title: `Library Test ${index + 1}`,
	author: 'Test Author'
}));
type ReadKind = 'ratings' | 'ratedDetails' | 'bookmarks' | 'dismissals' | 'bookmarkDetails';

async function setup(page: Page, failures: ReadKind[], cached = false) {
	const session = {
		access_token: 'library-load-test-token',
		token_type: 'bearer',
		refresh_token: 'test-refresh',
		expires_in: 3600,
		expires_at: Math.floor(Date.now() / 1000) + 3600,
		user: {
			id: userId,
			is_anonymous: false,
			aud: 'authenticated',
			role: 'authenticated',
			email: 'test@example.com',
			app_metadata: { provider: 'email' },
			user_metadata: {},
			created_at: new Date().toISOString()
		}
	};
	await page.addInitScript(
		({ authKey, session, books, cached, userId }) => {
			localStorage.setItem(authKey, JSON.stringify(session));
			if (cached)
				localStorage.setItem(
					`book-doctor:library-cache:v1:${userId}`,
					JSON.stringify(books.slice(0, 10).map((book) => ({ ...book, rating: 4 })))
				);
		},
		{ authKey, session, books, cached, userId }
	);
	const state = {
		failures: new Set(failures),
		reads: new Map<ReadKind, number>(),
		writes: 0,
		generations: 0
	};
	async function read(kind: ReadKind, route: Route, data: unknown) {
		state.reads.set(kind, (state.reads.get(kind) ?? 0) + 1);
		return state.failures.has(kind)
			? route.fulfill({ status: 503, json: { message: 'Temporarily unavailable', code: 'TEST' } })
			: route.fulfill({ json: data });
	}
	await page.route('**/auth/v1/**', (route) => route.fulfill({ json: session }));
	await page.route('**/rest/v1/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const table = url.pathname.split('/').at(-1);
		if (request.method() !== 'GET') {
			if (table === 'recommendation_requests') {
				state.generations++;
				return route.fulfill({ json: { id: 42 } });
			}
			if (table === 'feed_requests') return route.fulfill({ json: { id: 7 } });
			state.writes++;
			return route.fulfill({ status: 204, body: '' });
		}
		if (table === 'user_ratings')
			return read(
				url.searchParams.get('select')?.includes('book_name') ? 'ratedDetails' : 'ratings',
				route,
				books.slice(0, 10).map((book) => ({
					book_id: book.book_id,
					book_rating: 4,
					books: { ...book, book_name: book.title }
				}))
			);
		if (table === 'user_bookmarks')
			return read('bookmarks', route, [
				{ book_id: books[10].book_id, books: { ...books[10], book_name: books[10].title } }
			]);
		if (table === 'user_not_interested') return read('dismissals', route, []);
		return route.fulfill({ json: [] });
	});
	await page.route('**/api/**', (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/api/bookmarks') return read('bookmarkDetails', route, { books: [books[10]] });
		if (path === '/api/books/popular')
			return route.fulfill({ json: { books: books.slice(11), hasMore: false, nextOffset: 5 } });
		if (path === '/api/recommendations/count') return route.fulfill({ json: { count: 0 } });
		if (path === '/api/feed') return route.fulfill({ json: { status: 'completed', books: [] } });
		return route.fulfill({ json: { books: [], rated_count: 10, interaction_count: 11 } });
	});
	return state;
}

test('a failed first rating load shows Retry, then loads without refetching successful collections', async ({
	page
}) => {
	test.setTimeout(90_000);
	const state = await setup(page, ['ratings']);
	await page.goto(`${base}/my-bookshelf?filter=rated`, { waitUntil: 'domcontentloaded' });
	await expect.poll(() => state.reads.get('ratings') ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
	const notice = page.getByTestId('library-load-notice');
	await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({
		timeout: 20_000
	});
	await expect(
		page.getByText('No books rated yet. Rate at least 10 to get recommendations.', { exact: true })
	).toHaveCount(0);
	const bookmarkReads = state.reads.get('bookmarks');
	const dismissalReads = state.reads.get('dismissals');
	state.failures.clear();
	await notice.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(page.locator('.book-card')).toHaveCount(10);
	await expect(notice).toHaveCount(0);
	expect(state.reads.get('ratings')).toBe(5);
	expect(state.reads.get('bookmarks')).toBe(bookmarkReads);
	expect(state.reads.get('dismissals')).toBe(dismissalReads);
});

test('a bookmark ID failure leaves rating actions usable and blocks recommendation generation', async ({
	page
}) => {
	const state = await setup(page, ['bookmarks']);
	await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
	const notice = page.locator('#rate-bottom-bar').getByTestId('library-load-notice');
	await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({
		timeout: 20_000
	});
	const card = page.locator('.book-card').first();
	await expect(page.locator('#ratings-trigger')).toContainText('10');
	await expect(card.locator('.book-card__star').first()).toBeEnabled();
	await expect(card.getByRole('button', { name: 'Add to Bookmarks', exact: true })).toBeDisabled();
	await expect(
		page
			.locator('#rate-bottom-bar')
			.getByRole('button', { name: 'Get Book Recommendations', exact: true })
	).toHaveCount(0);
	expect(state.generations).toBe(0);
	state.failures.clear();
	await notice.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(
		page
			.locator('#rate-bottom-bar')
			.getByRole('button', { name: 'Get Book Recommendations', exact: true })
	).toBeEnabled();
	await expect(card.getByRole('button', { name: 'Add to Bookmarks', exact: true })).toBeEnabled();
});

test('cached rated books remain visible and editable through a failed details refresh', async ({
	page
}) => {
	const state = await setup(page, ['ratedDetails'], true);
	await page.goto(`${base}/my-bookshelf?filter=rated`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('.book-card')).toHaveCount(10);
	const notice = page.getByTestId('library-load-notice');
	await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({
		timeout: 20_000
	});
	await expect(notice).toContainText('Showing previously loaded books');
	const card = page.locator(`.book-card[data-book-id="${books[0].id}"]`);
	await card.locator('.book-card__star').nth(4).click();
	await expect.poll(() => state.writes).toBe(1);
	state.failures.clear();
	await notice.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(notice).toHaveCount(0);
	await expect(card.locator('.book-card__star').nth(4)).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('.book-card')).toHaveCount(10);
	expect(state.reads.get('ratings')).toBe(1);
});

test('a bookmark drawer failure waits for Retry and reopening starts a fresh attempt', async ({
	page
}) => {
	const state = await setup(page, ['bookmarkDetails']);
	await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
	await expect(
		page
			.locator('#rate-bottom-bar')
			.getByRole('button', { name: 'Get Book Recommendations', exact: true })
	).toBeEnabled();
	await page.locator('#ratings-trigger').click();
	const panel = page.locator('#ratings-drawer-panel');
	await panel.getByRole('tab', { name: /Bookmark/ }).click();
	const notice = panel.getByTestId('library-load-notice');
	await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({
		timeout: 20_000
	});
	await expect(panel.getByText('No bookmarked books yet.', { exact: false })).toHaveCount(0);
	expect(state.reads.get('bookmarkDetails')).toBe(4);
	await page.evaluate(() => {
		window.dispatchEvent(new Event('online'));
		window.dispatchEvent(new Event('focus'));
	});
	await page.waitForTimeout(1200);
	expect(state.reads.get('bookmarkDetails')).toBe(4);
	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
	state.failures.clear();
	await page.locator('#ratings-trigger').click();
	await panel.getByRole('tab', { name: /Bookmark/ }).click();
	await expect(
		panel.locator('.ratings-drawer__item-title', { hasText: books[10].title })
	).toBeVisible();
	await expect(panel.getByTestId('library-load-notice')).toHaveCount(0);
	expect(state.reads.get('bookmarkDetails')).toBe(5);
});

test('missing book details preserve the known rating count and do not block recommendations', async ({
	page
}) => {
	test.setTimeout(90_000);
	const state = await setup(page, ['ratedDetails']);
	await page.goto(`${base}/my-bookshelf?filter=rated`, { waitUntil: 'domcontentloaded' });
	await expect.poll(() => state.reads.get('ratings') ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
	await expect(
		page.getByTestId('library-load-notice').getByRole('button', { name: 'Retry', exact: true })
	).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole('tab', { name: 'Rated, 10', exact: true })).toBeVisible();
	await expect(
		page.getByText('No books rated yet. Rate at least 10 to get recommendations.', { exact: true })
	).toHaveCount(0);
	await page.getByRole('link', { name: 'Rate books', exact: true }).click();
	await expect(page).toHaveURL(`${base}/rate`);
	await expect(
		page
			.locator('#rate-bottom-bar')
			.getByRole('button', { name: 'Get Book Recommendations', exact: true })
	).toBeEnabled();
});
