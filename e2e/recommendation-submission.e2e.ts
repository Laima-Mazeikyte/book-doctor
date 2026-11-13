import { expect, test, type Page, type Route } from '@playwright/test';
import { loadEnv } from 'vite';
import { flavorFixture } from '../src/lib/recommendations/flavorGroups.fixture';

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
	const state = { inserts: 0, bodies: [] as unknown[], failedRequestId: null as string | null };
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
			if (table === 'feed_requests') return route.fulfill({ json: { public_id: 'FeedRunA' } });
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
					books: url.searchParams.get('request_id') === state.failedRequestId ? [] : [books[10]],
					status:
						url.searchParams.get('request_id') === state.failedRequestId ? 'failed' : 'completed',
					error_code:
						url.searchParams.get('request_id') === state.failedRequestId
							? 'recommendation_failed'
							: null,
					flavor_groups:
						url.searchParams.get('request_id') === state.failedRequestId
							? null
							: flavorFixture([{ book_id: books[10].book_id, rank: 1 }]),
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
		await route.fulfill({ json: { public_id: 'K7mQ2xBa' } });
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
	await expect(page).toHaveURL(/shortlist\?request_id=K7mQ2xBa/);
	await expect(
		page.locator('.group-slide--active').getByRole('button', { name: /Submission Book 11 by/ })
	).toBeVisible();
	expect(state.inserts).toBe(1);
	expect(state.bodies).toEqual([{ user_id: userId, output_format: 'flavors_v1' }]);
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
		await route.fulfill({ json: { public_id: 'NextRun1' } });
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
	await expect(page).toHaveURL(/shortlist\?request_id=NextRun1/);
});

test('leaving Browse while creation is pending prevents its response from redirecting', async ({
	page
}) => {
	const pending = gate();
	const state = await setup(page, async (route) => {
		await pending.promise;
		await route.fulfill({ json: { public_id: 'NextRun2' } });
	});
	await (await openRate(page)).click();
	await expect.poll(() => state.inserts).toBe(1);
	await page.getByRole('link', { name: 'Choose filters', exact: true }).click();
	await expect(page).toHaveURL(`${base}/discover`);
	const response = page.waitForResponse(
		(r) => r.url().includes('/rest/v1/recommendation_requests') && r.request().method() === 'POST'
	);
	pending.release();
	await response;
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
	);
	await expect(page).toHaveURL(`${base}/discover`);
});

test('failed grouped requests use the guarded submission retry flow', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const pending = gate();
	const state = await setup(page, async (route, attempt) => {
		if (attempt === 1)
			return route.fulfill({ status: 503, json: { message: 'Unavailable', code: 'TEST' } });
		await pending.promise;
		await route.fulfill({ json: { public_id: 'NextRun3' } });
	});
	state.failedRequestId = '42';
	await page.goto(`${base}/rate/recommendations/shortlist?request_id=42`, {
		waitUntil: 'domcontentloaded'
	});
	const button = page.getByRole('button', {
		name: '[COPY: recommendation-generation-failed-action]',
		exact: true
	});
	await expect(button).toBeEnabled();
	await button.click();
	const notice = page.getByTestId('recommendation-submission-error');
	await expect(notice).toContainText('start recommendations');
	await expect(page).toHaveURL(/shortlist\?request_id=42/);
	await expect(button).toBeEnabled();
	await notice.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(button).toBeDisabled();
	await expect.poll(() => state.inserts).toBe(2);
	await button.evaluate((el: HTMLButtonElement) => el.click());
	expect(state.inserts).toBe(2);
	pending.release();
	await expect(page).toHaveURL(/shortlist\?request_id=NextRun3/);
	await expect(
		page.locator('.group-slide--active').getByRole('button', { name: /Submission Book 11 by/ })
	).toBeVisible();
	expect(state.inserts).toBe(2);
});
