import { expect, test, type Page, type Route } from '@playwright/test';
import { loadEnv } from 'vite';

test.setTimeout(90_000);
const base = 'http://127.0.0.1:4173';
const env = loadEnv('development', process.cwd(), '');
const supabaseUrl = env.PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
const authKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const userId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const books = Array.from({ length: 12 }, (_, i) => ({
	id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
	book_id: `01${String(i + 1).padStart(24, '0')}`,
	title: `Submission Book ${i + 1}`,
	author: 'Test Author'
}));

function gate() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

async function setup(page: Page, create: (route: Route, attempt: number) => Promise<void>) {
	const session = {
		access_token: 'submission-test-token',
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
		({ authKey, session }) => {
			localStorage.setItem(authKey, JSON.stringify(session));
		},
		{ authKey, session }
	);
	const state = { inserts: 0, bodies: [] as unknown[] };
	await page.route('**/auth/v1/**', (route) => route.fulfill({ json: session }));
	await page.route('**/rest/v1/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const table = url.pathname.split('/').at(-1);
		if (request.method() !== 'GET') {
			if (table === 'recommendation_requests') {
				state.inserts++;
				state.bodies.push(request.postDataJSON());
				return create(route, state.inserts);
			}
			if (table === 'feed_requests') return route.fulfill({ json: { id: 7 } });
			return route.fulfill({ status: 204, body: '' });
		}
		if (table === 'user_ratings')
			return route.fulfill({
				headers: { 'content-range': '*/10', 'access-control-expose-headers': 'content-range' },
				json: books.slice(0, 10).map((book) => ({
					book_id: book.book_id,
					book_rating: 4,
					books: { ...book, book_name: book.title }
				}))
			});
		return route.fulfill({
			json: [],
			headers: { 'content-range': '*/0', 'access-control-expose-headers': 'content-range' }
		});
	});
	await page.route('**/api/**', (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === '/api/books/popular')
			return route.fulfill({
				json: {
					books: books.slice(10),
					nextOffset: 2,
					hasMore: false
				}
			});
		if (url.pathname === '/api/recommendations')
			return route.fulfill({
				json: {
					books: [books[10]],
					request_id: url.searchParams.get('request_id')
				}
			});
		if (url.pathname === '/api/recommendations/count') return route.fulfill({ json: { count: 0 } });
		if (url.pathname === '/api/feed')
			return route.fulfill({ json: { books: [], status: 'completed' } });
		return route.fulfill({ json: { books: [], rated_count: 10, interaction_count: 10 } });
	});
	return state;
}

async function openRate(page: Page) {
	await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
	const button = page
		.locator('#rate-bottom-bar')
		.getByRole('button', { name: 'Get Book Recommendations', exact: true });
	await expect(button).toBeEnabled({ timeout: 45_000 });
	return button;
}

test('rapid clicks and keyboard activation create one request and keep a stable, focused busy button', async ({
	page
}) => {
	const pending = gate();
	const state = await setup(page, async (route) => {
		await pending.promise;
		await route.fulfill({ json: { id: 99 } });
	});
	const button = await openRate(page);
	const bounds = await button.boundingBox();
	await button.focus();
	await button.evaluate((el: HTMLButtonElement) => {
		el.click();
		el.click();
	});
	const busy = page
		.locator('#rate-bottom-bar')
		.getByRole('button', { name: 'Starting recommendations…', exact: true });
	await expect(busy).toHaveAttribute('aria-busy', 'true');
	await expect(busy).toHaveAttribute('aria-disabled', 'true');
	await expect(busy).toBeFocused();
	await page.keyboard.press('Enter');
	await expect.poll(() => state.inserts).toBe(1);
	const busyBounds = await busy.boundingBox();
	expect(Math.abs(busyBounds!.width - bounds!.width)).toBeLessThan(1);
	expect(Math.abs(busyBounds!.height - bounds!.height)).toBeLessThan(1);
	pending.release();
	await expect(page).toHaveURL(/shortlist\?request_id=99/);
	await expect(page.getByRole('heading', { name: books[10].title, exact: true })).toBeVisible();
	expect(state.inserts).toBe(1);
	expect(state.bodies).toEqual([{ user_id: userId }]);
});

test('creation failure stays on Browse and manual Retry preserves focus until it opens the shortlist', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const pending = gate();
	const state = await setup(page, async (route, attempt) => {
		if (attempt === 1)
			return route.fulfill({ status: 503, json: { message: 'Unavailable', code: 'TEST' } });
		await pending.promise;
		await route.fulfill({ json: { id: 100 } });
	});
	await (await openRate(page)).click();
	const notice = page.getByTestId('recommendation-submission-error');
	await expect(notice).toContainText('Couldn’t start recommendations');
	await expect(page).toHaveURL(`${base}/rate`);
	await expect(page.locator('.book-card')).toHaveCount(2);
	await page.screenshot({ path: testInfo.outputPath('browse-submission-error.png') });
	expect(state.inserts).toBe(1);
	const retry = notice.getByRole('button', { name: 'Retry', exact: true });
	await retry.click();
	await expect(retry).toHaveAttribute('aria-disabled', 'true');
	await expect(retry).toBeFocused();
	await page.keyboard.press('Enter');
	await expect.poll(() => state.inserts).toBe(2);
	pending.release();
	await expect(page).toHaveURL(/shortlist\?request_id=100/);
});

test('leaving Browse while creation is pending prevents its response from redirecting', async ({
	page
}) => {
	const pending = gate();
	const state = await setup(page, async (route) => {
		await pending.promise;
		await route.fulfill({ json: { id: 101 } });
	});
	await (await openRate(page)).click();
	await expect.poll(() => state.inserts).toBe(1);
	await page.getByRole('link', { name: 'Choose filters', exact: true }).click();
	await expect(page).toHaveURL(`${base}/rate/recommendations/filtered`);
	const response = page.waitForResponse(
		(r) => r.url().includes('/rest/v1/recommendation_requests') && r.request().method() === 'POST'
	);
	pending.release();
	await response;
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
	);
	await expect(page).toHaveURL(`${base}/rate/recommendations/filtered`);
});

test('shortlist submission exposes errors, retains its books, and uses the same guarded Retry flow', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const pending = gate();
	const state = await setup(page, async (route, attempt) => {
		if (attempt === 1)
			return route.fulfill({ status: 503, json: { message: 'Unavailable', code: 'TEST' } });
		await pending.promise;
		await route.fulfill({ json: { id: 102 } });
	});
	await page.goto(`${base}/rate/recommendations/shortlist?request_id=42`, {
		waitUntil: 'domcontentloaded'
	});
	const book = page.getByRole('article', { name: `${books[10].title}, book 1 of 1`, exact: true });
	await expect(book).toBeVisible({
		timeout: 45_000
	});
	await page.getByRole('button', { name: 'Not interested', exact: true }).click();
	const button = page.getByRole('button', { name: 'Get new recommendations', exact: true });
	await expect(button).toBeEnabled();
	const bounds = await button.boundingBox();
	await button.click();
	const notice = page.getByTestId('recommendation-submission-error');
	await expect(notice).toContainText('Couldn’t start recommendations');
	await expect(page).toHaveURL(/shortlist\?request_id=42/);
	await expect(book).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('shortlist-submission-error.png') });
	await notice.getByRole('button', { name: 'Retry', exact: true }).click();
	const busy = page.getByRole('button', { name: 'Starting recommendations…', exact: true });
	await expect(busy).toHaveAttribute('aria-disabled', 'true');
	const busyBounds = await busy.boundingBox();
	expect(Math.abs(busyBounds!.width - bounds!.width)).toBeLessThan(1);
	expect(Math.abs(busyBounds!.height - bounds!.height)).toBeLessThan(1);
	await expect.poll(() => state.inserts).toBe(2);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	pending.release();
	await expect(page).toHaveURL(/shortlist\?request_id=102/);
	await expect(
		page.getByRole('button', { name: 'Starting recommendations…', exact: true })
	).toHaveCount(0);
	expect(state.inserts).toBe(2);
});
