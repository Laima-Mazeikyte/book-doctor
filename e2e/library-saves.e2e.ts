import { expect, test, type Page, type Route } from '@playwright/test';
import { loadEnv } from 'vite';

test.setTimeout(60_000);

const base = 'http://127.0.0.1:4173';
const env = loadEnv('development', process.cwd(), '');
const supabaseUrl = env.PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
const authKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pendingKey = `book-doctor:library-pending:v1:${userId}`;
const books = Array.from({ length: 40 }, (_, i) => ({
	id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
	book_id: `01${String(i + 1).padStart(24, '0')}`,
	title: `Save Test Book ${i + 1}`,
	author: 'Test Author',
	summary: 'A book used to exercise library saving.'
}));
const rated = Array.from({ length: 10 }, (_, i) => ({
	book_id: `01${String(i + 101).padStart(24, '0')}`,
	book_rating: 4,
	books: {
		id: `00000000-0000-4000-8000-${String(i + 101).padStart(12, '0')}`,
		book_id: `01${String(i + 101).padStart(24, '0')}`,
		book_name: `Previously Rated ${i + 1}`,
		author: 'Test Author'
	}
}));

async function setup(page: Page, guest = false, initialRatings = 10) {
	const session = {
		access_token: 'library-save-test-token',
		token_type: 'bearer',
		refresh_token: 'library-save-test-refresh',
		expires_in: 3600,
		expires_at: Math.floor(Date.now() / 1000) + 3600,
		user: {
			is_anonymous: guest,
			id: userId,
			aud: 'authenticated',
			role: 'authenticated',
			email: 'test@example.com',
			app_metadata: { provider: 'email' },
			user_metadata: {},
			created_at: new Date().toISOString()
		}
	};
	await page.addInitScript(
		({ authKey, session, guest }) => {
			if (!guest && !localStorage.getItem(authKey))
				localStorage.setItem(authKey, JSON.stringify(session));
		},
		{ authKey, session, guest }
	);
	const state = {
		status: 503,
		writes: [] as { table: string; method: string }[],
		bookmarks: new Set<string>(),
		holdAdd: null as null | (() => Promise<void>),
		holdWrite: null as null | (() => Promise<void>),
		recommendations: 0,
		nextRequestId: 43
	};
	await page.route('**/auth/v1/**', (route) => route.fulfill({ json: session }));
	await page.route('**/rest/v1/**', async (route: Route) => {
		const request = route.request();
		const url = new URL(request.url());
		const table = url.pathname.split('/').at(-1)!;
		if (request.method() === 'GET') {
			if (table === 'user_ratings')
				return route.fulfill({
					json: rated.slice(0, initialRatings),
					headers: {
						'content-range': `*/${initialRatings}`,
						'access-control-expose-headers': 'content-range'
					}
				});
			if (table === 'user_bookmarks')
				return route.fulfill({
					headers: {
						'content-range': `*/${state.bookmarks.size}`,
						'access-control-expose-headers': 'content-range'
					},
					json: books
						.filter((book) => state.bookmarks.has(book.book_id))
						.map((book) => ({ book_id: book.book_id, books: { ...book, book_name: book.title } }))
				});
			if (table === 'books')
				return route.fulfill({ json: books.map((book) => ({ ...book, book_name: book.title })) });
			return route.fulfill({
				json: [],
				headers: { 'content-range': '*/0', 'access-control-expose-headers': 'content-range' }
			});
		}
		if (table === 'recommendation_requests') {
			state.recommendations++;
			return route.fulfill({ json: { id: state.nextRequestId++ } });
		}
		if (table === 'feed_requests') return route.fulfill({ json: { id: 7 } });
		state.writes.push({ table, method: request.method() });
		await state.holdWrite?.();
		if (table === 'user_bookmarks' && request.method() === 'POST') await state.holdAdd?.();
		if (state.status !== 200)
			return route.fulfill({
				status: state.status,
				json: { message: 'Temporarily unavailable', code: 'TEST' }
			});
		if (table === 'user_bookmarks') {
			if (request.method() === 'POST') state.bookmarks.add(request.postDataJSON().book_id);
			else state.bookmarks.delete(url.searchParams.get('book_id')?.replace('eq.', '') ?? '');
		}
		return route.fulfill({ status: 204, body: '' });
	});
	await page.route('**/api/**', (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/api/books/popular')
			return route.fulfill({ json: { books, nextOffset: 40, hasMore: false } });
		if (path === '/api/recommendations/count') return route.fulfill({ json: { count: 1 } });
		if (path === '/api/recommendations')
			return route.fulfill({ json: { books: books.slice(0, 10), request_id: '42' } });
		if (path === '/api/feed') return route.fulfill({ json: { status: 'completed', books: [] } });
		return route.fulfill({
			json: { books: [], request_id: null, rated_count: 0, interaction_count: 0 }
		});
	});
	await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('.book-card').first()).toBeVisible({ timeout: 15_000 });
	if (!guest && initialRatings >= 10)
		await expect(
			page
				.locator('#rate-bottom-bar')
				.getByRole('button', { name: 'Get Book Recommendations', exact: true })
		).toBeEnabled();
	if (!guest) await expect(page.locator('#ratings-trigger')).toContainText(String(initialRatings));
	return state;
}

async function pauseClock(page: Page) {
	const now = Date.now();
	await page.clock.install({ time: now });
	// Automatic retries must advance only when the test asks, even on a slow machine.
	await page.clock.pauseAt(now + 60_000);
}

async function exhaust(page: Page, state: { writes: unknown[] }, initial: number, perAttempt = 1) {
	await expect.poll(() => state.writes.length).toBe(initial);
	for (const [i, ms] of [1000, 2000, 5000].entries()) {
		await expect
			.poll(() =>
				page.evaluate(
					(key) =>
						JSON.parse(localStorage.getItem(key) ?? '[]').filter(
							(c: { status: string }) => c.status === 'retrying'
						).length,
					pendingKey
				)
			)
			.toBe(perAttempt);
		await page.clock.fastForward(ms);
		await expect.poll(() => state.writes.length).toBe(initial + (i + 1) * perAttempt);
	}
}

for (const width of [1280, 390]) {
	test(`normal saves keep actions, counts, and recommendation controls quiet at ${width}px`, async ({
		page
	}) => {
		await page.setViewportSize({ width, height: 844 });
		const state = await setup(page);
		state.status = 200;
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		state.holdWrite = () => pending;
		const cards = page.locator('.book-card');
		await cards.nth(0).locator('.book-card__star').nth(3).click();
		await cards.nth(1).getByRole('button', { name: 'Add to Bookmarks', exact: true }).click();
		await cards.nth(2).getByRole('button', { name: 'Not interested', exact: true }).click();
		await expect.poll(() => state.writes.length).toBe(3);
		const cta = page
			.locator('#rate-bottom-bar')
			.getByRole('button', { name: 'Get Book Recommendations', exact: true });
		await expect(cta).toBeEnabled();
		await expect(cta).not.toHaveAttribute('aria-busy', 'true');
		await expect(page.locator('#ratings-trigger')).toContainText('11');
		await expect(page.getByText('Saving changes…', { exact: true })).toHaveCount(0);
		await expect(page.locator('.ratings-sync-dot--pending')).toHaveCount(0);
		await expect(page.getByTestId('library-save-notice')).toHaveCount(0);
		await page.locator('#ratings-trigger').click();
		await expect(page.locator('.ratings-drawer-panel')).toBeVisible();
		await expect(page.locator('.ratings-drawer__header-sync')).toHaveCount(0);
		await page.getByRole('button', { name: 'Close bookshelf', exact: true }).click();
		await expect(page.locator('.ratings-drawer-overlay')).toHaveCount(0);
		const before = {
			cta: await cta.boundingBox(),
			counter: await page.locator('#ratings-trigger').boundingBox(),
			stars: await cards.nth(0).locator('.book-card__rating').boundingBox()
		};
		release();
		await expect
			.poll(() => page.evaluate((key) => localStorage.getItem(key), pendingKey))
			.toBeNull();
		await expect(cta).toBeEnabled();
		await expect(page.locator('#ratings-trigger')).toContainText('11');
		await expect(page.locator('.ratings-sync-dot--pending')).toHaveCount(0);
		await expect(page.getByText('Saving changes…', { exact: true })).toHaveCount(0);
		const after = {
			cta: await cta.boundingBox(),
			counter: await page.locator('#ratings-trigger').boundingBox(),
			stars: await cards.nth(0).locator('.book-card__rating').boundingBox()
		};
		for (const element of ['cta', 'counter', 'stars'] as const) {
			for (const dimension of ['x', 'y', 'width', 'height'] as const)
				expect(Math.abs(after[element]![dimension] - before[element]![dimension])).toBeLessThan(1);
		}
		expect(state.recommendations).toBe(0);
	});
}

test('the tenth local rating reveals the normal CTA while submission waits for its save', async ({
	page
}) => {
	const state = await setup(page, false, 9);
	state.status = 200;
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	state.holdWrite = () => pending;
	await page.locator('.book-card').first().locator('.book-card__star').nth(3).click();
	await expect.poll(() => state.writes.length).toBe(1);
	await expect(page.locator('#ratings-trigger')).toContainText('10');
	const cta = page
		.locator('#rate-bottom-bar')
		.getByRole('button', { name: 'Get Book Recommendations', exact: true });
	await expect(cta).toBeEnabled();
	await expect(page.locator('.ratings-sync-dot--pending')).toHaveCount(0);
	await expect(page.getByText('Saving changes…', { exact: true })).toHaveCount(0);
	await cta.click();
	await expect(
		page.getByRole('button', { name: 'Starting recommendations…', exact: true })
	).toHaveAttribute('aria-disabled', 'true');
	expect(state.recommendations).toBe(0);
	release();
	await expect(page).toHaveURL(/\/rate\/recommendations\/shortlist\?request_id=43$/);
	expect(state.recommendations).toBe(1);
});

test('a failed bookmark survives reload, blocks recommendations, and saves only after Retry', async ({
	page
}) => {
	const state = await setup(page);
	await pauseClock(page);
	const card = page.locator(`.book-card[data-book-id="${books[0].id}"]`);
	await card.getByRole('button', { name: 'Add to Bookmarks', exact: true }).click();
	await expect(card.getByRole('img', { name: 'Saving changes…' })).toHaveCount(0);
	await exhaust(page, state, 1);
	const notice = page.getByTestId('library-save-notice');
	await expect(notice).toContainText('1 bookmark');
	await expect(page.locator('#rate-bottom-bar')).not.toContainText('Changes need saving');
	await expect(
		page
			.locator('#rate-bottom-bar')
			.getByRole('button', { name: 'Get Book Recommendations', exact: true })
	).toBeDisabled();
	await page.evaluate(() => {
		window.dispatchEvent(new Event('online'));
		window.dispatchEvent(new Event('focus'));
	});
	await page.clock.fastForward(60_000);
	expect(state.writes).toHaveLength(4);
	await page.clock.resume();
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(notice).toContainText('1 bookmark', { timeout: 15_000 });
	expect(state.writes).toHaveLength(4);
	// The restored book is visible even though the server has not saved it yet.
	await page.goto(`${base}/my-bookshelf?filter=bookmarked`, { waitUntil: 'domcontentloaded' });
	await expect(notice).toBeVisible();
	await expect(page.locator(`.book-card[data-book-id="${books[0].id}"]`)).toBeVisible();
	state.status = 200;
	await notice.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(notice).toHaveCount(0);
	await expect.poll(() => state.writes.length).toBe(5);
	await expect.poll(() => state.bookmarks.has(books[0].book_id)).toBe(true);
	await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), pendingKey)).toBeNull();
});

test('a first guest action is claimed by its anonymous session and survives reload', async ({
	page
}) => {
	const state = await setup(page, true);
	state.status = 403;
	await page
		.locator('.book-card')
		.first()
		.getByRole('button', { name: 'Add to Bookmarks', exact: true })
		.click();
	const notice = page.getByTestId('library-save-notice');
	await expect(notice).toContainText('1 bookmark');
	await expect
		.poll(() =>
			page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]')[0]?.ownerId, pendingKey)
		)
		.toBe(userId);
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(notice).toContainText('1 bookmark', { timeout: 15_000 });
	expect(state.writes).toHaveLength(1);
	state.status = 200;
	await notice.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect.poll(() => state.writes.length).toBe(2);
	await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), pendingKey)).toBeNull();
});

test('sign-out clears only this account snapshots while retaining its failed-save journal', async ({
	page
}) => {
	const state = await setup(page);
	state.status = 403;
	await page
		.locator('.book-card')
		.first()
		.getByRole('button', {
			name: 'Add to Bookmarks',
			exact: true
		})
		.click();
	await expect(page.getByTestId('library-save-notice')).toContainText('1 bookmark');
	const cacheKey = `book-doctor:library-cache:v2:${userId}`;
	await expect
		.poll(() => page.evaluate((key) => localStorage.getItem(key), cacheKey))
		.not.toBeNull();
	await page.evaluate(() => {
		localStorage.setItem('book-doctor:library-cache:v2:another-account', 'other-account-snapshot');
	});
	await page.getByRole('button', { name: 'Account', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
	await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), cacheKey)).toBeNull();
	const stored = await page.evaluate(
		(key) => ({
			pending: JSON.parse(localStorage.getItem(key) ?? '[]'),
			other: localStorage.getItem('book-doctor:library-cache:v2:another-account')
		}),
		pendingKey
	);
	expect(stored.pending).toHaveLength(1);
	expect(stored.pending[0].ownerId).toBe(userId);
	expect(stored.other).toBe('other-account-snapshot');
	expect(state.writes).toHaveLength(1);
});

test('another account never replays a failed save and the original account restores it', async ({
	page
}) => {
	const state = await setup(page);
	state.status = 403;
	await page
		.locator('.book-card')
		.first()
		.getByRole('button', { name: 'Add to Bookmarks', exact: true })
		.click();
	const notice = page.getByTestId('library-save-notice');
	await expect(notice).toContainText('1 bookmark');
	async function switchAccount(id: string) {
		await page.evaluate(
			({ authKey, id }) => {
				const session = JSON.parse(localStorage.getItem(authKey)!);
				session.user.id = id;
				localStorage.setItem(authKey, JSON.stringify(session));
			},
			{ authKey, id }
		);
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.locator('.book-card').first()).toBeVisible({ timeout: 15_000 });
	}
	await switchAccount('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
	await expect(
		page
			.locator('#rate-bottom-bar')
			.getByRole('button', { name: 'Get Book Recommendations', exact: true })
	).toBeEnabled();
	await expect(notice).toHaveCount(0);
	expect(state.writes).toHaveLength(1);
	await switchAccount(userId);
	await expect(notice).toContainText('1 bookmark');
	expect(state.writes).toHaveLength(1);
	state.status = 200;
	await notice.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect.poll(() => state.writes.length).toBe(2);
	await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), pendingKey)).toBeNull();
});

test('all three failures are counted together and remain actionable on the shortlist', async ({
	page
}) => {
	const state = await setup(page);
	await pauseClock(page);
	const cards = page.locator('.book-card');
	await cards.nth(0).getByRole('button', { name: 'Add to Bookmarks', exact: true }).click();
	await cards.nth(1).locator('.book-card__star').nth(3).click();
	await cards.nth(2).getByRole('button', { name: 'Not interested', exact: true }).click();
	await exhaust(page, state, 3, 3);
	const notice = page.getByTestId('library-save-notice');
	await expect(notice).toContainText('1 rating, 1 bookmark, and 1 “Not interested” change');
	expect(state.recommendations).toBe(0);
	await page.clock.resume();
	await page.goto(`${base}/rate/recommendations/shortlist?request_id=42`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(notice).toContainText('1 rating, 1 bookmark, and 1 “Not interested” change');
	await expect(page.locator('.shortlist-carousel')).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	const bounds = await notice.boundingBox();
	expect(bounds!.x).toBeGreaterThanOrEqual(0);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
	await page.screenshot({ path: 'test-results/library-save-notice-mobile.png' });
	state.status = 200;
	await notice.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(notice).toHaveCount(0);
	await expect.poll(() => state.writes.length).toBe(15);
	await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), pendingKey)).toBeNull();
});

test('a quick bookmark undo waits for the add request and finishes unbookmarked', async ({
	page
}) => {
	const state = await setup(page);
	state.status = 200;
	let release!: () => void;
	state.holdAdd = () =>
		new Promise<void>((resolve) => {
			release = resolve;
		});
	const card = page.locator(`.book-card[data-book-id="${books[0].id}"]`);
	await card.getByRole('button', { name: 'Add to Bookmarks', exact: true }).click();
	await expect.poll(() => state.writes.length).toBe(1);
	await card.getByRole('button', { name: 'Remove from Bookmarks', exact: true }).click();
	expect(state.writes).toHaveLength(1);
	release();
	await expect.poll(() => state.writes.length).toBe(2);
	await expect(card.getByRole('button', { name: 'Add to Bookmarks', exact: true })).toBeVisible();
	await expect.poll(() => state.bookmarks.size).toBe(0);
	await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), pendingKey)).toBeNull();
});

test('shortlist dismissal, replacement, and reset stay reactive through a new recommendation run', async ({
	page
}) => {
	test.setTimeout(45_000);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const state = await setup(page);
	state.status = 200;
	await page.goto(`${base}/rate/recommendations/shortlist?request_id=42`, {
		waitUntil: 'domcontentloaded'
	});
	const active = page.locator('.shortlist-slide--active:not([id*="clone"])');
	const dots = page.locator('.shortlist-position__dot');
	const dismiss = () => active.getByRole('button', { name: 'Not interested', exact: true }).click();
	const undo = () =>
		active.getByRole('button', { name: 'Remove from not interested', exact: true }).click();
	const another = () => active.getByRole('button', { name: 'Get another book', exact: true });
	const expectBook = (index: number) =>
		expect(active.getByRole('heading', { name: books[index].title, exact: true })).toBeVisible();

	await expectBook(0);
	await expect(dots).toHaveCount(7);
	await dismiss();
	await expect(another()).toBeEnabled();
	await undo();
	await expect(another()).toHaveCount(0);
	await dismiss();
	await another().click();
	await expectBook(7);
	await expect(dots).toHaveCount(8);

	// Returning to a dismissed book must not offer the same replacement twice.
	await active.getByRole('button', { name: 'Previous book', exact: true }).click();
	await expectBook(0);
	await expect(another()).toHaveCount(0);
	// Bookmarking undoes the dismissal and clears its replacement bookkeeping.
	await active.getByRole('button', { name: 'Add to Bookmarks', exact: true }).click();
	await dismiss();
	await expect(another()).toBeEnabled();
	await another().click();
	await expectBook(8);
	await dismiss();
	await another().click();
	await expectBook(9);
	await expect(dots).toHaveCount(10);
	await dismiss();
	await active.getByRole('button', { name: 'Get new recommendations', exact: true }).click();
	await expect(page).toHaveURL(/shortlist\?request_id=43$/);
	await expectBook(0);
	await expect(dots).toHaveCount(7);
	expect(state.recommendations).toBe(1);

	// The new run resets the replacement limits and per-book dismissal state.
	await undo();
	await dismiss();
	await expect(another()).toBeEnabled();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page).toHaveURL(`${base}/rate/recommendations`);
});
