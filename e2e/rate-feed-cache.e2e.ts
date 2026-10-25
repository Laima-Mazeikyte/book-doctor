import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from 'vite';

test.setTimeout(90_000);
const base = process.env.RATE_FEED_TEST_ORIGIN || 'http://127.0.0.1:4173';
const env = loadEnv('development', process.cwd(), '');
const authKey = `sb-${new URL(env.PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const owner = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const key = `book-doctor:rate-feed:v1:${owner}`;
const books = Array.from({ length: 110 }, (_, index) => ({
	id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
	book_id: `01${String(index + 1).padStart(24, '0')}`,
	title: `Snapshot Book ${index + 1}`,
	author: 'Snapshot Author',
	summary: `A complete cached description for Snapshot Book ${index + 1}.`,
	year: '1984',
	genres: ['Fantasy'],
	type: 'Novel'
}));
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function setup(
	page: Page,
	options: {
		invalid?: 'corrupt' | 'expired' | 'partial-library';
		exclusions?: boolean;
		feedCache?: boolean;
		libraryCache?: boolean;
		signedOut?: boolean;
		expiredSession?: boolean;
	} = {}
) {
	const session = {
		access_token: 'feed-cache-test-token',
		token_type: 'bearer',
		refresh_token: 'fixture-refresh',
		expires_in: 3600,
		expires_at: Math.floor(Date.now() / 1000) + 3600,
		user: {
			id: owner,
			is_anonymous: false,
			aud: 'authenticated',
			role: 'authenticated',
			email: 'snapshot@example.com',
			app_metadata: { provider: 'email' },
			user_metadata: {},
			created_at: new Date().toISOString()
		}
	};
	await page.addInitScript(
		({ session, authKey, owner, key, books, options }) => {
			if (localStorage.getItem('feed-fixture-seeded')) return;
			localStorage.setItem('feed-fixture-seeded', 'yes');
			if (options.signedOut) return;
			localStorage.setItem(
				authKey,
				JSON.stringify(options.expiredSession ? { ...session, expires_at: 1 } : session)
			);
			const rated = options.exclusions
				? { ...books[0], rating: 4 }
				: {
						id: 'rated-outside',
						book_id: 'rated-ulid-outside',
						title: 'Prior rating',
						author: 'Author',
						rating: 4
					};
			if (options.libraryCache !== false)
				localStorage.setItem(
					`book-doctor:library-cache:v2:${owner}`,
					JSON.stringify({
						version: 2,
						ownerId: owner,
						collections: {
							ratings: {
								entries: [{ id: rated.id, book_id: rated.book_id, rating: 4 }],
								books: [rated]
							},
							bookmarks: options.exclusions ? [{ id: books[1].id, book_id: books[1].book_id }] : [],
							...(options.invalid === 'partial-library'
								? {}
								: { dismissals: options.exclusions ? [books[2].book_id] : [] })
						}
					})
				);
			if (options.exclusions)
				localStorage.setItem(
					`book-doctor:library-pending:v1:${owner}`,
					JSON.stringify([
						{
							kind: 'dismissal',
							ownerId: owner,
							bookUlid: books[3].book_id,
							bookId: books[3].id,
							value: true,
							revision: 1,
							attempts: 4,
							status: 'failed',
							nextAttemptAt: 0,
							error: 'Fixture save failure',
							errorKind: 'connection'
						}
					])
				);
			if (options.feedCache !== false)
				localStorage.setItem(
					key,
					options.invalid === 'corrupt'
						? 'broken json'
						: JSON.stringify({
								version: 1,
								ownerId: owner,
								fetchedAt: Date.now() - (options.invalid === 'expired' ? 86_400_001 : 60_000),
								source: { kind: 'curated', requestId: 'persisted-completed' },
								books: books.slice(0, 50)
							})
				);
		},
		{ session, authKey, owner, key, books, options }
	);
	let feedGate = deferred();
	const libraryGate = deferred();
	const authGate = deferred();
	if (!options.expiredSession) authGate.resolve();
	const state = {
		authRequests: 0,
		feedReads: 0,
		feedResponses: 0,
		jobs: 0,
		writes: 0,
		popularReads: 0,
		status: 200,
		latest: {
			mode: 'has_eligible_feed',
			books: books.slice(50, 100),
			request_id: 'live-completed',
			latest_request_id: 'live-completed',
			latest_request_status: 'completed',
			latest_request_error_message: null,
			ratings_count: 1,
			interaction_count: 1,
			eligible_for_feed: true,
			status: 'completed',
			error_message: null
		},
		releaseFeed: () => feedGate.resolve(),
		releaseLibrary: () => libraryGate.resolve(),
		releaseAuth: () => authGate.resolve(),
		resetFeed: () => {
			feedGate = deferred();
		}
	};
	await page.route('**/auth/v1/**', async (route) => {
		state.authRequests++;
		await authGate.promise;
		return route.fulfill({ json: session });
	});
	await page.route('**/rest/v1/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const table = url.pathname.split('/').at(-1);
		if (request.method() !== 'GET') {
			if (table === 'feed_requests') {
				state.jobs++;
				return route.fulfill({ json: { id: 'unexpected-new-job' } });
			}
			state.writes++;
			return route.fulfill({ status: 204, body: '' });
		}
		await libraryGate.promise;
		const rated = options.exclusions
			? books[0]
			: {
					id: 'rated-outside',
					book_id: 'rated-ulid-outside',
					title: 'Prior rating',
					author: 'Author'
				};
		const rows =
			table === 'user_ratings'
				? [{ book_id: rated.book_id, book_rating: 4, books: { ...rated, book_name: rated.title } }]
				: table === 'user_bookmarks' && options.exclusions
					? [{ book_id: books[1].book_id, books: books[1] }]
					: table === 'user_not_interested' && options.exclusions
						? [{ book_id: books[2].book_id }]
						: [];
		await route.fulfill({
			json: rows,
			headers: {
				'content-range': `*/${rows.length}`,
				'access-control-expose-headers': 'content-range'
			}
		});
	});
	await page.route('**/api/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/api/feed/latest') {
			state.feedReads++;
			const gate = feedGate;
			await gate.promise;
			state.feedResponses++;
			await route.fulfill({
				status: state.status,
				json: state.status === 200 ? state.latest : { message: 'Fixture outage' }
			});
			return;
		}
		if (path === '/api/books/popular') {
			state.popularReads++;
			return route.fulfill({ json: { books: books.slice(100), hasMore: false, nextOffset: 10 } });
		}
		if (path === '/api/feed') return route.fulfill({ json: { status: 'completed', books: [] } });
		if (path === '/api/recommendations/count') return route.fulfill({ json: { count: 0 } });
		return route.fulfill({ json: { books: [] } });
	});
	return state;
}
async function rememberGrid(page: Page) {
	await page.evaluate(() => {
		(window as unknown as { feedNodes: Element[] }).feedNodes = [
			...document.querySelectorAll('.book-card')
		];
		// Keep a nonzero scroll position below automatic pagination's browse-credit boundary.
		window.scrollTo(0, 50);
	});
}
async function expectStableGrid(page: Page) {
	expect(
		await page.evaluate(() => {
			const before = (window as unknown as { feedNodes: Element[] }).feedNodes;
			const current = [...document.querySelectorAll('.book-card')];
			return current.length === before.length && current.every((node, i) => node === before[i]);
		})
	).toBe(true);
	expect(await page.evaluate(() => window.scrollY)).toBe(50);
	await expect(page.locator('.rate-page__list[aria-busy="true"]')).toHaveCount(0);
}

test('cached cards and actions work during a three-second feed/library wait, and an old read preserves the rating', async ({
	page
}) => {
	const state = await setup(page);
	await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('.book-card')).toHaveCount(50);
	expect(state.feedResponses).toBe(0);
	const card = page.locator(`.book-card[data-book-id="${books[0].id}"]`);
	await expect(card.locator('.book-card__star').nth(4)).toBeEnabled();
	await card.locator('.book-card__star').nth(4).click();
	await expect.poll(() => state.writes).toBe(1);
	await rememberGrid(page);
	await page.waitForTimeout(3000);
	await expectStableGrid(page);
	state.releaseFeed();
	state.releaseLibrary();
	await expect.poll(() => state.feedResponses).toBe(1);
	await expect(page.locator('#rate-bottom-bar').getByTestId('library-load-notice')).toHaveCount(0);
	await expect(card.locator('.book-card__star').nth(4)).toHaveAttribute('aria-pressed', 'true');
	await expectStableGrid(page);
	expect(state.jobs).toBe(0);
	expect(state.popularReads).toBe(0);
});

for (const outcome of ['empty', 'failed'] as const) {
	test(`a three-second ${outcome} refresh preserves cached cards`, async ({ page }) => {
		const state = await setup(page);
		state.releaseLibrary();
		if (outcome === 'failed') state.status = 503;
		else state.latest = { ...state.latest, books: [], mode: 'feed_exhausted' };
		await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('.book-card')).toHaveCount(50);
		await rememberGrid(page);
		await page.waitForTimeout(3000);
		state.releaseFeed();
		await expect.poll(() => state.feedResponses).toBe(1);
		await page.waitForTimeout(250);
		await expectStableGrid(page);
		expect(state.jobs).toBe(0);
		expect(state.popularReads).toBe(0);
	});
}

test('a fresh reordered snapshot is staged for the next reload and cached summaries remain usable', async ({
	page
}) => {
	const state = await setup(page);
	state.releaseLibrary();
	await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('.book-card')).toHaveCount(50);
	await page
		.locator('.book-card')
		.first()
		.getByRole('button', { name: /See summary/ })
		.first()
		.click();
	await expect(page.getByText(books[0].summary, { exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	state.releaseFeed();
	await expect
		.poll(async () =>
			page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).books[0].title, key)
		)
		.toBe(books[50].title);
	await expect(page.locator('.book-card').first()).toHaveAttribute('data-book-id', books[0].id);
	state.resetFeed();
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.locator('.book-card').first()).toHaveAttribute('data-book-id', books[50].id);
	expect(state.feedResponses).toBe(1);
	await expect.poll(() => state.feedReads).toBe(2);
	expect(state.jobs).toBe(0);
});

for (const invalid of ['corrupt', 'expired', 'partial-library'] as const) {
	test(`${invalid} snapshots retain the ordinary fresh-loading path`, async ({ page }) => {
		const state = await setup(page, { invalid });
		await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
		await expect.poll(() => state.feedReads).toBe(1);
		await expect(page.locator('.book-card')).toHaveCount(0);
		state.releaseLibrary();
		state.releaseFeed();
		await expect(page.locator('.book-card')).toHaveCount(50);
		await expect(page.locator('.book-card').first()).toHaveAttribute('data-book-id', books[50].id);
	});
}

for (const delayed of ['feed', 'library', 'both'] as const) {
	test(`direct uncached entry waits for ${delayed} without landing preparation`, async ({
		page
	}, testInfo) => {
		const state = await setup(page, { feedCache: false, libraryCache: false });
		const waitForFeed = delayed !== 'library';
		const waitForLibrary = delayed !== 'feed';
		if (!waitForFeed) state.releaseFeed();
		if (!waitForLibrary) state.releaseLibrary();
		type ColdEntryTiming = { firstCardMs: number | null; ratingEnabledMs: number | null };
		await page.addInitScript(() => {
			const timing: ColdEntryTiming = { firstCardMs: null, ratingEnabledMs: null };
			(window as unknown as { coldEntryTiming: ColdEntryTiming }).coldEntryTiming = timing;
			function sample() {
				const card = document.querySelector<HTMLElement>('.rate-page__list .book-card');
				if (card) {
					let visible = card.getBoundingClientRect().height > 0;
					for (let element: HTMLElement | null = card; element; element = element.parentElement) {
						const style = getComputedStyle(element);
						if (style.visibility === 'hidden' || Number(style.opacity) === 0) visible = false;
					}
					if (visible) timing.firstCardMs ??= performance.now();
					const rating = card.querySelector<HTMLButtonElement>('.book-card__star');
					if (rating && !rating.disabled && rating.getAttribute('aria-disabled') !== 'true')
						timing.ratingEnabledMs ??= performance.now();
				}
				if (
					(timing.firstCardMs === null || timing.ratingEnabledMs === null) &&
					performance.now() < 20_000
				)
					requestAnimationFrame(sample);
			}
			requestAnimationFrame(sample);
		});
		await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
		await expect.poll(() => state.feedReads).toBe(1);
		if (waitForFeed) {
			await expect(page.locator('.rate-page__list[aria-busy="true"]')).toBeVisible();
			await expect(page.locator('.book-card')).toHaveCount(0);
		} else {
			await expect(page.locator('.book-card')).toHaveCount(50);
			await expect(page.locator('.book-card__star').first()).toBeDisabled();
		}
		// Deliberately hold only fixture responses; this is a dependency check, not a real Supabase benchmark.
		await page.waitForTimeout(3000);
		const releasedAtMs = await page.evaluate(() => performance.now());
		state.releaseFeed();
		state.releaseLibrary();
		await expect(page.locator('.book-card')).toHaveCount(50);
		await expect(page.locator('.book-card__star').first()).toBeEnabled();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as { coldEntryTiming: ColdEntryTiming }).coldEntryTiming
							.ratingEnabledMs
				)
			)
			.toEqual(expect.any(Number));
		const timing = await page.evaluate(
			() => (window as unknown as { coldEntryTiming: ColdEntryTiming }).coldEntryTiming
		);
		const report = {
			delayed,
			releasedAtMs,
			...timing,
			feedReads: state.feedReads,
			generationWrites: state.jobs
		};
		await testInfo.attach(`direct-uncached-${delayed}`, {
			body: JSON.stringify(report, null, 2),
			contentType: 'application/json'
		});
		console.log(JSON.stringify({ directUncachedEntry: report }));
		if (waitForFeed) expect(timing.firstCardMs).toBeGreaterThanOrEqual(releasedAtMs);
		else expect(timing.firstCardMs).toBeLessThan(releasedAtMs);
		if (waitForLibrary) expect(timing.ratingEnabledMs).toBeGreaterThanOrEqual(releasedAtMs);
		expect(state.feedReads).toBe(1);
		expect(state.popularReads).toBe(0);
		expect(state.jobs).toBe(0);
		expect(state.writes).toBe(0);
	});
}

test('saved and failed pending exclusions filter the cached list before admission and survive another reload', async ({
	page
}) => {
	const state = await setup(page, { exclusions: true });
	await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('.book-card')).toHaveCount(46);
	await expect(page.locator('.book-card').first()).toHaveAttribute('data-book-id', books[4].id);
	await page
		.locator('.book-card')
		.first()
		.getByRole('button', { name: 'Add to Bookmarks', exact: true })
		.click();
	await expect.poll(() => state.writes).toBe(1);
	await expect
		.poll(async () =>
			page.evaluate(
				(owner) =>
					JSON.parse(localStorage.getItem(`book-doctor:library-cache:v2:${owner}`)!).collections
						.bookmarks.length,
				owner
			)
		)
		.toBe(2);
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.locator('.book-card')).toHaveCount(45);
	await expect(page.locator('.book-card').first()).toHaveAttribute('data-book-id', books[5].id);
	await expect(page.getByTestId('library-save-notice')).toContainText('Not interested');
	expect(state.jobs).toBe(0);
	expect(state.feedResponses).toBe(0);
});

test('logout clears this account feed without clearing another account or pending saves, and ignores a late read', async ({
	page
}) => {
	const state = await setup(page, { exclusions: true });
	await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('.book-card')).toHaveCount(46);
	await page.evaluate(() =>
		localStorage.setItem('book-doctor:rate-feed:v1:other-account', 'retained')
	);
	await page.getByRole('button', { name: 'Account', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
	await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
	state.releaseFeed();
	state.releaseLibrary();
	await page.waitForTimeout(300);
	expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
	expect(
		await page.evaluate(() => localStorage.getItem('book-doctor:rate-feed:v1:other-account'))
	).toBe('retained');
	expect(
		await page.evaluate(
			(owner) =>
				JSON.parse(localStorage.getItem(`book-doctor:library-pending:v1:${owner}`) ?? '[]').length,
			owner
		)
	).toBe(1);
	await expect(page.locator(`.book-card[data-book-id="${books[4].id}"]`)).toHaveCount(0);
});

test('a failed public page retains its load-more retry even after dismissing the error', async ({
	page
}) => {
	let reads = 0;
	await page.route('**/api/**', (route) => {
		if (new URL(route.request().url()).pathname !== '/api/books/popular')
			return route.fulfill({ json: { books: [], count: 0 } });
		reads++;
		if (reads === 2) return route.fulfill({ status: 503, json: { message: 'Fixture outage' } });
		return route.fulfill({
			json:
				reads === 1
					? { books: books.slice(0, 50), nextOffset: 50, hasMore: true, seed: 'public-seed' }
					: { books: books.slice(50, 60), nextOffset: 60, hasMore: false, seed: 'public-seed' }
		});
	});
	await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('.book-card')).toHaveCount(50);
	await page.evaluate(() => {
		(window as unknown as { firstPublicCard: Element | null }).firstPublicCard =
			document.querySelector('.book-card');
		window.scrollTo(0, document.documentElement.scrollHeight);
	});
	await expect(page.locator('.error-banner__message')).toHaveText(
		'Couldn’t load more books. Try again.'
	);
	await expect(page.locator('.rate-page__feed-unlock-hint')).toHaveCount(0);
	await page.locator('.error-banner__dismiss').click();
	await page.getByRole('button', { name: 'Load more books into the list', exact: true }).click();
	await expect(page.locator('.book-card')).toHaveCount(60);
	expect(reads).toBe(3);
	expect(
		await page.evaluate(
			() =>
				document.querySelector('.book-card') ===
				(window as unknown as { firstPublicCard: Element | null }).firstPublicCard
		)
	).toBe(true);
	await expect(
		page.getByRole('button', { name: 'Load more books into the list', exact: true })
	).toHaveCount(0);
	await expect(page.locator('.rate-page__feed-unlock-hint')).toBeVisible();
});

test('clicking before session restoration completes starts one feed read after restoration', async ({
	page
}) => {
	const state = await setup(page, { feedCache: false, expiredSession: true });
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	await expect.poll(() => state.authRequests).toBeGreaterThan(0);
	expect(state.feedReads).toBe(0);
	await page.getByRole('link', { name: 'Start rating', exact: true }).click();
	await expect(page).toHaveURL(`${base}/rate`);
	expect(state.feedReads).toBe(0);
	state.releaseAuth();
	state.releaseLibrary();
	state.releaseFeed();
	await expect(page.locator('.book-card')).toHaveCount(50);
	expect(state.feedReads).toBe(1);
	expect(state.jobs).toBe(0);
});

test('clicking during uncached landing preparation joins the read without creating a second one', async ({
	page
}) => {
	const state = await setup(page, { feedCache: false });
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	await expect.poll(() => state.feedReads).toBe(1);
	await page.getByRole('link', { name: 'Start rating', exact: true }).click();
	await expect(page).toHaveURL(`${base}/rate`);
	await expect(page.locator('.book-card')).toHaveCount(0);
	expect(state.feedReads).toBe(1);
	state.releaseLibrary();
	state.releaseFeed();
	await expect(page.locator('.book-card')).toHaveCount(50);
	expect(state.feedReads).toBe(1);
	expect(state.jobs).toBe(0);
});

test('completed landing preparation is reused on entry and repeat navigation', async ({ page }) => {
	const state = await setup(page, { feedCache: false });
	state.releaseLibrary();
	state.releaseFeed();
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	await expect.poll(() => state.feedResponses).toBe(1);
	await expect
		.poll(async () => page.evaluate((key) => localStorage.getItem(key) !== null, key))
		.toBe(true);
	for (let visit = 0; visit < 2; visit++) {
		await page.getByRole('link', { name: 'Start rating', exact: true }).click();
		await expect(page.locator('.book-card')).toHaveCount(50);
		await expect(page.locator('.book-card__star').first()).toBeEnabled();
		expect(state.feedReads).toBe(1);
		await page.getByRole('link', { name: 'Unread, home', exact: true }).first().click();
		await expect(page).toHaveURL(`${base}/`);
	}
	expect(state.jobs).toBe(0);
	expect(state.writes).toBe(0);
});

test('cached landing entry stays usable through a five-second reordered refresh', async ({
	page
}) => {
	const state = await setup(page);
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	await expect.poll(() => state.feedReads).toBe(1);
	await page.getByRole('link', { name: 'Start rating', exact: true }).click();
	await expect(page.locator('.book-card')).toHaveCount(50);
	await expect(page.locator('.book-card__star').first()).toBeEnabled();
	await rememberGrid(page);
	await page.waitForTimeout(5000);
	state.releaseFeed();
	state.releaseLibrary();
	await expect.poll(() => state.feedResponses).toBe(1);
	await expectStableGrid(page);
	expect(state.feedReads).toBe(1);
	expect(state.jobs).toBe(0);
});

test('prepared books preserve per-collection action readiness when interaction IDs are incomplete', async ({
	page
}) => {
	const state = await setup(page, { feedCache: false, invalid: 'partial-library' });
	state.releaseFeed();
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	await expect.poll(() => state.feedResponses).toBe(1);
	await page.getByRole('link', { name: 'Start rating', exact: true }).click();
	await expect(page.locator('.book-card')).toHaveCount(50);
	await expect(page.locator('.book-card__star').first()).toBeDisabled();
	await expect(
		page.getByRole('button', { name: 'Add to Bookmarks', exact: true }).first()
	).toBeDisabled();
	await expect(
		page.getByRole('button', { name: 'Not interested', exact: true }).first()
	).toBeDisabled();
	state.releaseLibrary();
	await expect(page.locator('.book-card__star').first()).toBeEnabled();
	await expect(
		page.getByRole('button', { name: 'Not interested', exact: true }).first()
	).toBeEnabled();
	expect(state.feedReads).toBe(1);
	expect(state.jobs).toBe(0);
});

for (const mode of ['feed_exhausted', 'feed_generation_pending', 'feed_error'] as const) {
	test(`remaining on the landing page with ${mode} performs no generation or writes`, async ({
		page
	}) => {
		const state = await setup(page, { feedCache: false });
		state.latest = { ...state.latest, mode, books: [] };
		state.releaseFeed();
		state.releaseLibrary();
		await page.goto(base, { waitUntil: 'domcontentloaded' });
		await expect.poll(() => state.feedResponses).toBe(1);
		await page.waitForTimeout(300);
		expect(state.feedReads).toBe(1);
		expect(state.jobs).toBe(0);
		expect(state.writes).toBe(0);
		await expect(page.getByRole('link', { name: 'Start rating', exact: true })).toBeEnabled();
	});
}

test('signed-out landing visitors create neither sessions nor feed requests', async ({ page }) => {
	const state = await setup(page, { signedOut: true });
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('button', { name: 'Log in', exact: true }).first()).toBeVisible();
	await page.waitForTimeout(300);
	expect(state.authRequests).toBe(0);
	expect(state.feedReads).toBe(0);
	expect(state.jobs).toBe(0);
	expect(state.writes).toBe(0);
});

test('a failed landing read stays quiet and rate entry can retry', async ({ page }) => {
	const state = await setup(page, { feedCache: false });
	state.status = 503;
	state.releaseFeed();
	state.releaseLibrary();
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	await expect.poll(() => state.feedResponses).toBe(1);
	await page.waitForTimeout(300);
	await expect(page.locator('.error-banner')).toHaveCount(0);
	expect(state.feedReads).toBe(1);
	state.status = 200;
	await page.getByRole('link', { name: 'Start rating', exact: true }).click();
	await expect(page.locator('.book-card')).toHaveCount(50);
	expect(state.feedReads).toBe(2);
	expect(state.jobs).toBe(0);
});

test('a timed-out landing read retains cached cards and permits a later read', async ({ page }) => {
	const state = await setup(page);
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	await expect.poll(() => state.feedReads).toBe(1);
	await page.getByRole('link', { name: 'Start rating', exact: true }).click();
	await expect(page.locator('.book-card')).toHaveCount(50);
	await rememberGrid(page);
	await page.waitForTimeout(10_100);
	await expectStableGrid(page);
	expect(await page.evaluate((key) => localStorage.getItem(key) !== null, key)).toBe(true);
	state.releaseLibrary();
	state.releaseFeed();
	await page.getByRole('link', { name: 'Unread, home', exact: true }).first().click();
	await expect.poll(() => state.feedReads).toBe(2);
	await expect.poll(() => state.feedResponses).toBe(2);
	expect(state.jobs).toBe(0);
});

type EntryMeasurement = {
	domCardMs: number | null;
	firstCardMs: number | null;
	usableActionMs: number | null;
};
async function recordEntryTiming(page: Page) {
	await page.evaluate(() => {
		document.addEventListener(
			'click',
			(event) => {
				const anchor = (event.target as Element | null)?.closest('a');
				if (anchor?.getAttribute('href') !== '/rate') return;
				const started = performance.now();
				const metrics: EntryMeasurement = {
					domCardMs: null,
					firstCardMs: null,
					usableActionMs: null
				};
				(window as unknown as { entryTiming: EntryMeasurement }).entryTiming = metrics;
				function sample() {
					const card = document.querySelector<HTMLElement>('.book-card');
					if (card) metrics.domCardMs ??= performance.now() - started;
					let visible = !!card && card.getBoundingClientRect().height > 0;
					for (let element = card; element; element = element.parentElement) {
						const style = getComputedStyle(element);
						if (style.visibility === 'hidden' || Number(style.opacity) === 0) visible = false;
					}
					if (card && visible) {
						metrics.firstCardMs ??= performance.now() - started;
						const action = card.querySelector<HTMLButtonElement>('.book-card__star');
						if (action && !action.disabled && action.getAttribute('aria-disabled') !== 'true') {
							metrics.usableActionMs = performance.now() - started;
							return;
						}
					}
					if (performance.now() - started < 15_000) requestAnimationFrame(sample);
				}
				requestAnimationFrame(sample);
			},
			true
		);
	});
}

for (const mode of ['disk-cache', 'prepared', 'warm-navigation'] as const) {
	test(`entry timing: ${mode} with ready route code`, async ({ page }, testInfo) => {
		test.skip(
			process.env.RATE_FEED_MEASURE !== 'true',
			'Run timing acceptance with the production-preview config on one worker.'
		);
		const state = await setup(page, { feedCache: mode === 'disk-cache' });
		state.releaseLibrary();
		if (mode !== 'disk-cache') state.releaseFeed();
		await page.goto(base, { waitUntil: 'domcontentloaded' });
		await expect.poll(() => state.feedReads).toBe(1);
		if (mode !== 'disk-cache') {
			await expect
				.poll(async () => page.evaluate((key) => localStorage.getItem(key) !== null, key))
				.toBe(true);
		}
		const start = () => page.getByRole('link', { name: 'Start rating', exact: true });
		// Hover uses the application's existing route-code preload behavior.
		await start().hover();
		await page.waitForTimeout(750);
		if (mode === 'warm-navigation') {
			await start().click();
			await expect(page.locator('.book-card')).toHaveCount(50);
			await page.getByRole('link', { name: 'Unread, home', exact: true }).first().click();
		}
		await recordEntryTiming(page);
		const samples: EntryMeasurement[] = [];
		for (let trial = 0; trial < 5; trial++) {
			await start().click();
			await expect(page.locator('.book-card')).toHaveCount(50);
			await expect
				.poll(async () =>
					page.evaluate(
						() =>
							(window as unknown as { entryTiming: EntryMeasurement }).entryTiming?.usableActionMs
					)
				)
				.toEqual(expect.any(Number));
			samples.push(
				await page.evaluate(
					() => (window as unknown as { entryTiming: EntryMeasurement }).entryTiming
				)
			);
			await page.getByRole('link', { name: 'Unread, home', exact: true }).first().click();
		}
		const report = {
			mode,
			origin: base,
			samples,
			feedReads: state.feedReads,
			generationWrites: state.jobs
		};
		await testInfo.attach(`entry-timing-${mode}`, {
			body: JSON.stringify(report, null, 2),
			contentType: 'application/json'
		});
		console.log(JSON.stringify(report));
		expect(state.feedReads).toBe(1);
		expect(state.jobs).toBe(0);
		if (mode === 'disk-cache') expect(state.feedResponses).toBe(0);
		for (const sample of samples) {
			expect(sample.firstCardMs).toBeLessThan(200);
			expect(sample.usableActionMs).toBeLessThan(200);
		}
	});
}

async function waitForVisibleRateCards(page: Page) {
	// DOM presence and Playwright's enabled/visible checks do not exclude opacity: 0.
	// Let the intentional route transition reveal the card before ending observation.
	await page.waitForFunction(() => {
		const card = document.querySelector<HTMLElement>('.rate-page__list .book-card');
		if (!card) return false;
		const rect = card.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight)
			return false;
		for (let element: HTMLElement | null = card; element; element = element.parentElement) {
			const style = getComputedStyle(element);
			if (
				style.visibility === 'hidden' ||
				style.visibility === 'collapse' ||
				Number(style.opacity) === 0
			)
				return false;
		}
		return true;
	});
}

for (const prepared of [false, true]) {
	test(`browser probe measures ${prepared ? 'completed preparation' : 'cached cards during pending refresh'}`, async ({
		page
	}) => {
		const state = await setup(page, { feedCache: !prepared });
		state.releaseLibrary();
		if (prepared) state.releaseFeed();
		await page.goto(base, { waitUntil: 'domcontentloaded' });
		await expect.poll(() => state.feedReads).toBe(1);
		if (prepared) await expect.poll(() => state.feedResponses).toBe(1);
		await page.addScriptTag({ path: 'scripts/diagnostics/rate-entry-browser-probe.js' });
		type ProbeReport = {
			label: string;
			firstCardMs: number;
			usableRatingMs: number;
			skeletonReturnedAfterCards: boolean;
			initialCardRemoved: boolean;
			latestFeedStartedBeforeClick: { startRelativeToClickMs: number } | null;
			completedFeedRequestsStartedAfterClick: number;
		};
		type Probe = { arm: (label: string) => void; report: () => ProbeReport };
		await page.evaluate(() =>
			(window as unknown as { rateEntryProbe: Probe }).rateEntryProbe.arm('fixture measurement')
		);
		await page.getByRole('link', { name: 'Start rating', exact: true }).click();
		await expect(page.locator('.book-card')).toHaveCount(50);
		await expect(page.locator('.book-card__star').first()).toBeEnabled();
		if (!prepared) {
			const response = page.waitForResponse(
				(response) => new URL(response.url()).pathname === '/api/feed/latest'
			);
			state.releaseFeed();
			await (await response).finished();
		}
		await expect.poll(() => state.feedResponses).toBe(1);
		await waitForVisibleRateCards(page);
		const result = await page.evaluate(() =>
			(window as unknown as { rateEntryProbe: Probe }).rateEntryProbe.report()
		);
		expect(result.label).toBe('fixture measurement');
		expect(result.firstCardMs).toBeGreaterThan(0);
		expect(result.usableRatingMs).toBeGreaterThanOrEqual(result.firstCardMs);
		expect(result.skeletonReturnedAfterCards).toBe(false);
		expect(result.initialCardRemoved).toBe(false);
		expect(result.latestFeedStartedBeforeClick?.startRelativeToClickMs).toBeLessThan(0);
		expect(result.completedFeedRequestsStartedAfterClick).toBe(0);
		expect(state.feedReads).toBe(1);
		expect(state.jobs).toBe(0);
	});
}

test('browser probe records a visible skeleton and a feed request beginning after the click', async ({
	page
}) => {
	const state = await setup(page, { feedCache: false, expiredSession: true });
	state.releaseLibrary();
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	await expect.poll(() => state.authRequests).toBeGreaterThan(0);
	await page.addScriptTag({ path: 'scripts/diagnostics/rate-entry-browser-probe.js' });
	type Probe = {
		arm: (label: string) => void;
		report: () => {
			firstCardMs: number;
			usableRatingMs: number;
			skeletonBeforeCards: boolean;
			completedFeedRequestsStartedAfterClick: number;
		};
	};
	await page.evaluate(() =>
		(window as unknown as { rateEntryProbe: Probe }).rateEntryProbe.arm('delayed entry')
	);
	await page.getByRole('link', { name: 'Start rating', exact: true }).click();
	state.releaseAuth();
	await expect.poll(() => state.feedReads).toBe(1);
	await expect(page.locator('.rate-page__list[aria-busy="true"]')).toBeVisible();
	await page.waitForTimeout(200);
	const response = page.waitForResponse(
		(response) => new URL(response.url()).pathname === '/api/feed/latest'
	);
	state.releaseFeed();
	await (await response).finished();
	await expect(page.locator('.book-card')).toHaveCount(50);
	await expect(page.locator('.book-card__star').first()).toBeEnabled();
	const result = await page.evaluate(() =>
		(window as unknown as { rateEntryProbe: Probe }).rateEntryProbe.report()
	);
	expect(result.skeletonBeforeCards).toBe(true);
	expect(result.firstCardMs).toBeGreaterThanOrEqual(200);
	expect(result.usableRatingMs).toBeGreaterThanOrEqual(result.firstCardMs);
	expect(result.completedFeedRequestsStartedAfterClick).toBe(1);
});

for (const reason of ['offscreen', 'disabled'] as const) {
	test(`browser probe distinguishes ${reason} rating controls from slow card display`, async ({
		page
	}) => {
		const state = await setup(
			page,
			reason === 'disabled' ? { feedCache: false, invalid: 'partial-library' } : {}
		);
		if (reason === 'disabled') state.releaseFeed();
		else state.releaseLibrary();
		await page.goto(base, { waitUntil: 'domcontentloaded' });
		await expect.poll(() => state.feedReads).toBe(1);
		if (reason === 'disabled') await expect.poll(() => state.feedResponses).toBe(1);
		if (reason === 'offscreen')
			await page.addStyleTag({
				content: '.book-card__rating-wrap { transform: translateY(2000px); }'
			});
		await page.addScriptTag({ path: 'scripts/diagnostics/rate-entry-browser-probe.js' });
		type ControlState = { firstRating: { enabled: boolean; visible: boolean } };
		type Probe = {
			arm: (label: string) => void;
			inspect: () => ControlState;
			report: () => {
				firstCardMs: number;
				ratingEnabledMs: number | null;
				usableRatingMs: number | null;
				controlsAtReport: ControlState;
			};
		};
		await page.evaluate(() =>
			(window as unknown as { rateEntryProbe: Probe }).rateEntryProbe.arm('control diagnosis')
		);
		await page.getByRole('link', { name: 'Start rating', exact: true }).click();
		await expect(page.locator('.book-card')).toHaveCount(50);
		await waitForVisibleRateCards(page);
		const controls = await page.evaluate(() =>
			(window as unknown as { rateEntryProbe: Probe }).rateEntryProbe.inspect()
		);
		expect(controls.firstRating.enabled).toBe(reason === 'offscreen');
		expect(controls.firstRating.visible).toBe(reason !== 'offscreen');
		const result = await page.evaluate(() =>
			(window as unknown as { rateEntryProbe: Probe }).rateEntryProbe.report()
		);
		expect(result.firstCardMs).toBeGreaterThan(0);
		expect(result.usableRatingMs).toBeNull();
		if (reason === 'offscreen') expect(result.ratingEnabledMs).toEqual(expect.any(Number));
		else expect(result.ratingEnabledMs).toBeNull();
		expect(result.controlsAtReport).toEqual(controls);
	});
}
