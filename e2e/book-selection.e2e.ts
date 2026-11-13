import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from 'vite';

test.setTimeout(90_000);
const base = 'http://127.0.0.1:4173';
const env = loadEnv('development', process.cwd(), '');
const authKey = `sb-${new URL(env.PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const books = Array.from({ length: 220 }, (_, i) => ({
	id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
	book_id: `01${String(i).padStart(24, '0')}`,
	title: `Selection Book ${i}`,
	author: 'Test Author'
}));

async function setup(page: Page, count = 10) {
	page.on('pageerror', (error) => console.error('Selection browser error:', error.stack));
	const state = {
		posts: [] as { request_type: string; book_ids: string[] }[],
		writes: 0,
		status: 'processing',
		resultReads: 0,
		resultCount: 10,
		uncertain: false,
		missing: false,
		longTitles: false,
		errorCode: 'invalid_selection',
		skipped: [] as string[],
		failSource: false,
		holdRecent: false,
		runId: 'ChooseA1'
	};
	const session = {
		access_token: 'selection-test-token',
		refresh_token: 'test-refresh',
		token_type: 'bearer',
		expires_in: 3600,
		expires_at: Math.floor(Date.now() / 1000) + 3600,
		user: {
			id: userId,
			is_anonymous: false,
			aud: 'authenticated',
			role: 'authenticated',
			email: 'test@example.com',
			app_metadata: { provider: 'email', has_recommendations: true },
			user_metadata: {},
			created_at: new Date().toISOString()
		}
	};
	await page.addInitScript(
		({ authKey, session }) => localStorage.setItem(authKey, JSON.stringify(session)),
		{ authKey, session }
	);
	await page.route('**/auth/v1/**', (route) => route.fulfill({ json: session }));
	await page.route('**/rest/v1/**', (route) => {
		const request = route.request();
		if (request.method() !== 'GET') {
			state.writes++;
			return route.fulfill({ status: 204, body: '' });
		}
		const url = new URL(request.url());
		const table = url.pathname.split('/').at(-1);
		const rows = (data: unknown[]) =>
			route.fulfill({
				json: data,
				headers: {
					'content-range': `*/${data.length}`,
					'access-control-expose-headers': 'content-range'
				}
			});
		if (table === 'user_ratings')
			return rows([
				{
					book_id: books[0].book_id,
					book_rating: 4,
					books: { ...books[0], book_name: books[0].title }
				}
			]);
		if (table === 'user_bookmarks')
			return rows(
				books
					.slice(0, count)
					.map((book) => ({ book_id: book.book_id, books: { ...book, book_name: book.title } }))
			);
		if (table === 'user_not_interested') return rows([{ book_id: books[1].book_id }]);
		if (table === 'books') {
			const ids = url.searchParams.get('book_id')?.slice(4, -1).split(',') ?? [];
			return route.fulfill({
				json: books
					.filter((book) => ids.includes(book.book_id))
					.map((book) => ({
						...book,
						book_name:
							state.longTitles && book.book_id === books[2].book_id
								? "The Tyranny of Merit: What's Become of the Common Good? An Extended Title for Layout Testing"
								: book.title,
						summary: `Complete synopsis for ${book.title}.`,
						slug: `selection-book-${book.book_id}`
					}))
			});
		}
		return route.fulfill({ json: [], headers: { 'content-range': '*/0' } });
	});
	await page.route('**/functions/v1/book-search', (route) =>
		route.fulfill({
			json: { hits: books.slice(0, 8).map(({ book_id }) => ({ book_id })), estimatedTotalHits: 8 }
		})
	);
	const row = () => ({
		public_id: state.runId,
		...(state.posts.at(-1) ?? {
			request_type: 'rank_selection',
			book_ids: books.slice(2, 10).map((book) => book.book_id)
		}),
		status: state.status,
		result_count: state.status === 'completed' ? state.resultCount : null,
		error_code: state.status === 'failed' ? state.errorCode : null,
		skipped_book_ids: state.skipped,
		created_at: new Date().toISOString()
	});
	await page.route('**/api/**', (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.pathname === '/api/recommendations/selection') {
			if (request.method() === 'POST') {
				state.posts.push(request.postDataJSON());
				return state.uncertain
					? route.fulfill({ status: 502, json: { message: 'Outcome unknown' } })
					: route.fulfill({ status: 201, json: { request_id: state.runId } });
			}
			if (url.searchParams.has('request_id')) {
				const run = row();
				return route.fulfill({
					json: {
						request: run,
						...(url.searchParams.has('include_books')
							? {
									books: books.filter(
										(book) =>
											run.book_ids.includes(book.book_id) &&
											(!state.missing || book.book_id !== run.book_ids[0])
									)
								}
							: {})
					}
				});
			}
			return route.fulfill({
				json: { requests: state.posts.length && !state.holdRecent ? [row()] : [] }
			});
		}
		if (url.pathname === '/api/bookmarks')
			return state.failSource
				? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
				: route.fulfill({ json: { books: books.slice(0, count) } });
		if (url.pathname === '/api/recommendations/unique')
			return route.fulfill({
				json: {
					books: books.slice(5, 15),
					hasRuns: true,
					lastRecommendedAt: Object.fromEntries(
						books.slice(5, 15).map((book, i) => [book.book_id, 10000 - i])
					)
				}
			});
		if (url.pathname === '/api/recommendations') {
			state.resultReads++;
			const run = row();
			const inspiration = run.request_type === 'recommend_from_selection';
			return route.fulfill({
				json: {
					books: (inspiration
						? books.filter((book) => !run.book_ids.includes(book.book_id))
						: books.filter(
								(book) =>
									run.book_ids.includes(book.book_id) && !state.skipped.includes(book.book_id)
							)
					).slice(0, state.resultCount),
					request_id: state.runId,
					request_type: run.request_type,
					likedBookPrecedentsByBookId: inspiration ? { [books[10].book_id]: [books[2]] } : {},
					selectionSeedBookIds: inspiration ? [books[10].book_id] : []
				}
			});
		}
		if (url.pathname === '/api/recommendations/count')
			return route.fulfill({ json: { count: 10 } });
		return route.fulfill({ json: { books: [], rated_count: 1, interaction_count: 1 } });
	});
	return state;
}

test('plain entry renders the picker without source reads, count refresh, or rated-details warmup', async ({
	page
}) => {
	const state = await setup(page);
	await mockStripCovers(page);
	const reads: URL[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/api/') || request.url().includes('/rest/v1/'))
			reads.push(new URL(request.url()));
	});
	await page.goto(`${base}/choose-books`);
	await expect(page.getByRole('searchbox')).toBeVisible();
	await expect(page.locator('.selection-tools > span')).toHaveText('0 books selected');
	await expect
		.poll(() => reads.some((url) => url.pathname === '/api/recommendations/selection'))
		.toBe(true);
	await page.getByRole('searchbox').fill('Se');
	await expect(page.getByText('Type at least 3 characters to search books.')).toBeVisible();
	expect(
		reads.filter((url) =>
			['/api/bookmarks', '/api/recommendations/unique', '/api/recommendations/count'].includes(
				url.pathname
			)
		)
	).toEqual([]);
	expect(
		reads.filter(
			(url) =>
				url.pathname.endsWith('/user_ratings') &&
				url.searchParams.get('select')?.includes('summary')
		)
	).toEqual([]);
	expect(state.posts).toHaveLength(0);
});

test('search and draft editing work while safety IDs load, but submitting stays disabled', async ({
	page
}) => {
	const state = await setup(page);
	await mockStripCovers(page);
	let release = () => {};
	const held = new Promise<void>((done) => {
		release = done;
	});
	await page.route('**/rest/v1/user_not_interested?**', async (route) => {
		await held;
		await route.fallback();
	});
	await page.goto(`${base}/choose-books`);
	try {
		await page.getByRole('searchbox').fill('Selection');
		for (const i of [0, 1, 2, 3])
			await page.getByRole('button', { name: `Add Selection Book ${i}`, exact: true }).click();
		await expect(page.locator('.selection-tools > span')).toHaveText('4 books selected');
		await expect(page.locator('.selection-action button')).toBeDisabled();
		await expect(page.locator('.action-readiness')).toContainText('Loading your library');
		expect(state.posts).toHaveLength(0);
	} finally {
		release();
	}
	await expect(page.locator('.selection-action button')).toBeEnabled();
	await expect(page.locator('.selection-tools > span')).toHaveText('4 books selected');
});

for (const change of ['selection', 'source', 'mode']) {
	test(`late bookmark preselection never overwrites a ${change} change`, async ({ page }) => {
		await setup(page);
		await mockStripCovers(page);
		await page.addInitScript(
			({ userId, book }) =>
				sessionStorage.setItem(
					`unread:selection-drafts:v1:${userId}`,
					JSON.stringify({ rank_selection: [book], recommend_from_selection: [] })
				),
			{ userId, book: books[12] }
		);
		let release = () => {};
		const held = new Promise<void>((done) => {
			release = done;
		});
		let reads = 0;
		await page.route('**/api/bookmarks', async (route) => {
			reads++;
			await held;
			await route.fallback();
		});
		await page.goto(`${base}/choose-books?from=bookmarks`);
		try {
			await expect(page.locator('.selection-tools > span')).toHaveText('1 book selected');
			await expect(page.getByText('Loading the collection…')).toBeVisible();
			if (change === 'selection')
				await page.getByRole('button', { name: 'Clear entire selection', exact: true }).click();
			else if (change === 'source')
				await page.getByRole('button', { name: 'All books', exact: true }).click();
			else
				await page
					.locator('.mode-tabs')
					.getByRole('button', { name: 'Find more like these', exact: true })
					.click();
			await expect(page).not.toHaveURL(/from=/);
		} finally {
			release();
		}
		await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
		await expect(page.locator('.candidate-grid li')).toHaveCount(10);
		await expect(page.locator('.selection-tools > span')).toHaveText(
			change === 'source' ? '1 book selected' : '0 books selected'
		);
		expect(reads).toBe(1);
	});
}

test('bookmark entry loads history independently and never requests the unused recommendation source', async ({
	page
}) => {
	const state = await setup(page);
	await mockStripCovers(page);
	state.posts.push({
		request_type: 'rank_selection',
		book_ids: books.slice(2, 10).map((book) => book.book_id)
	});
	let release = () => {};
	const held = new Promise<void>((done) => {
		release = done;
	});
	const unused: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/api/recommendations/unique')) unused.push(request.url());
	});
	await page.route('**/api/bookmarks', async (route) => {
		await held;
		await route.fallback();
	});
	await page.goto(`${base}/choose-books?from=bookmarks`);
	try {
		await expect(page.getByRole('searchbox')).toBeVisible();
		await expect(page.locator('.recent-selections a')).toHaveCount(1);
		await expect(page.getByText('Loading the collection…')).toBeVisible();
		expect(unused).toEqual([]);
	} finally {
		release();
	}
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
});

test('opening existing draft details while bookmark entry loads does not cancel automatic selection', async ({
	page
}) => {
	await setup(page);
	await mockStripCovers(page);
	await page.addInitScript(
		({ userId, book }) =>
			sessionStorage.setItem(
				`unread:selection-drafts:v1:${userId}`,
				JSON.stringify({ rank_selection: [book], recommend_from_selection: [] })
			),
		{ userId, book: books[12] }
	);
	let release = () => {};
	const held = new Promise<void>((done) => {
		release = done;
	});
	await page.route('**/api/bookmarks', async (route) => {
		await held;
		await route.fallback();
	});
	await page.goto(`${base}/choose-books?from=bookmarks`);
	try {
		await page.locator('[data-copy="1"] .cover-hit').first().click();
		await expect(page.getByTestId('book-summary-sheet')).toBeVisible();
		await expect(page).toHaveURL(/from=bookmarks/);
		await page.keyboard.press('Escape');
	} finally {
		release();
	}
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await expect(page).not.toHaveURL(/from=/);
});

test('recommendation source ignores a late response from a different account', async ({ page }) => {
	await setup(page);
	await mockStripCovers(page);
	let release = () => {};
	const held = new Promise<void>((done) => {
		release = done;
	});
	await page.route('**/api/recommendations/unique?view=selection', async (route) => {
		await held;
		try {
			await route.fallback();
		} catch {
			/* Cancelled old-account read. */
		}
	});
	await page.goto(`${base}/choose-books?from=recommendations`);
	await expect(page.getByText('Loading the collection…')).toBeVisible();
	await page.route('**/auth/v1/logout*', (route) => route.fulfill({ status: 204, body: '' }));
	await page.getByRole('button', { name: 'Account', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
	release();
	await expect(
		page.getByRole('heading', { name: 'Sign in to choose books', exact: true })
	).toBeVisible();
	await expect(page.locator('.candidate-grid')).toHaveCount(0);
	await expect(page.locator('.selection-results')).toHaveCount(0);
});

test('source loading, empty collections, search-empty, and failures remain distinct and retry only that source', async ({
	page
}) => {
	await setup(page);
	await mockStripCovers(page);
	let reads = 0;
	await page.route('**/api/recommendations/unique?view=selection', (route) => {
		reads++;
		return route.fulfill({ json: { books: [], lastRecommendedAt: {} } });
	});
	await page.route('**/api/bookmarks', (route) => route.fulfill({ json: { books: [] } }));
	await page.goto(`${base}/choose-books`);
	await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
	await expect(
		page.getByText("You haven't bookmarked any books yet.", { exact: true })
	).toBeVisible();
	await page.getByRole('searchbox').fill('Missing');
	await expect(page.getByText('No books match your search.', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Previous recommendations', exact: true }).click();
	await expect(
		page.getByText('No previous recommendations available.', { exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'All books', exact: true }).click();
	await page.getByRole('button', { name: 'Previous recommendations', exact: true }).click();
	expect(reads).toBe(1);
	// A fresh page visit to this account also reuses the successful empty snapshot.
	await page.getByRole('link', { name: 'FAQ', exact: true }).click();
	await expect(page).toHaveURL(/\/faq$/);
	await page.goBack();
	await page.getByRole('button', { name: 'Previous recommendations', exact: true }).click();
	await expect(
		page.getByText('No previous recommendations available.', { exact: true })
	).toBeVisible();
	expect(reads).toBe(1);
});

test('a failed recommendation collection leaves search usable and retries without fetching bookmarks', async ({
	page
}) => {
	await setup(page);
	let works = false;
	const bookmarks: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/api/bookmarks') bookmarks.push(request.url());
	});
	await page.route('**/api/recommendations/unique?view=selection', (route) =>
		works
			? route.fulfill({ json: { books: [], lastRecommendedAt: {} } })
			: route.fulfill({ status: 503, json: {} })
	);
	await page.goto(`${base}/choose-books?from=recommendations`);
	await expect(page.locator('.browser-state [role="alert"]')).toContainText(
		'Could not load previous recommendations.'
	);
	await expect(page.getByText('No books match your search.', { exact: true })).toHaveCount(0);
	works = true;
	await page.locator('.browser-state').getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(
		page.getByText('No previous recommendations available.', { exact: true })
	).toBeVisible();
	await expect(page).not.toHaveURL(/from=/);
	expect(bookmarks).toEqual([]);
});

test('a loaded bookmark shelf is reused on selection entry without another bookmark read', async ({
	page
}) => {
	await setup(page);
	await mockStripCovers(page);
	let reads = 0;
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/api/bookmarks') reads++;
	});
	await page.goto(`${base}/my-bookshelf?filter=bookmarked`);
	await expect(page.locator('.bookshelf-page__list .book-card').first()).toBeVisible();
	const before = reads;
	await page.getByRole('link', { name: 'Rank my list', exact: true }).click();
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	expect(reads).toBe(before);
});

test('recommendation revalidation updates candidates but never changes selected books or their order', async ({
	page
}) => {
	await setup(page);
	await mockStripCovers(page);
	let reads = 0;
	let release = () => {};
	const held = new Promise<void>((done) => {
		release = done;
	});
	await page.route('**/api/recommendations/unique?view=selection', async (route) => {
		reads++;
		if (reads > 1) await held;
		await route.fallback();
	});
	await page.goto(`${base}/choose-books?from=recommendations`);
	await expect(page.locator('.selection-tools > span')).toHaveText('10 books selected');
	const before = await page
		.locator('[data-copy="1"] .selected-book')
		.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.bookId));
	await page.locator('.candidate-grid li').first().locator('.candidate-cover-hit').click();
	const panel = page.getByTestId('book-summary-sheet');
	await panel.getByRole('button', { name: 'Rate 4 out of 5', exact: true }).click();
	try {
		await expect.poll(() => reads).toBe(2);
		await expect(page.locator('.selection-tools > span')).toHaveText('10 books selected');
	} finally {
		release();
	}
	await page.keyboard.press('Escape');
	await expect(page.locator('.candidate-grid li')).toHaveCount(9);
	expect(
		await page
			.locator('[data-copy="1"] .selected-book')
			.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.bookId))
	).toEqual(before);
});

for (const origin of ['bookmarks', 'recommendations']) {
	test(`selection cap copy names unrated ${origin} and the mode limit`, async ({ page }) => {
		const state = await setup(page, 215);
		if (origin === 'recommendations')
			await page.route('**/api/recommendations/unique?view=selection', (route) =>
				route.fulfill({
					json: {
						books: books.slice(0, 215),
						hasRuns: true,
						lastRecommendedAt: Object.fromEntries(
							books.slice(0, 215).map((book, index) => [book.book_id, 10000 - index])
						)
					}
				})
			);
		await page.goto(`${base}/choose-books?from=${origin}`);
		await expect(page.locator('.selection-tools > span')).toHaveText('200 / 200 books selected');
		await expect(
			page.getByText(
				`Selected 200 most recently ${origin === 'bookmarks' ? 'bookmarked' : 'recommended'} unrated books.`,
				{ exact: true }
			)
		).toBeVisible();
		await page.getByRole('button', { name: 'Clear entire selection', exact: true }).click();
		await expect(
			page.getByText(
				'Search for books or add your bookmarks and previous recommendations for consideration.',
				{ exact: true }
			)
		).toBeVisible();
		await page
			.getByRole('button', {
				name: origin === 'bookmarks' ? 'Add all Bookmarks' : 'Add all previous recommendations',
				exact: true
			})
			.click();
		await expect(
			page.getByText('This mode supports a maximum of 200 books.', { exact: true })
		).toBeVisible();
		expect(state.writes).toBe(0);
		expect(state.posts).toHaveLength(0);
	});
}

test('a failed saved selection uses approved copy without replacing the current selection', async ({
	page
}) => {
	const state = await setup(page, 10);
	state.status = 'failed';
	state.posts.push({
		request_type: 'rank_selection',
		book_ids: books.slice(2, 10).map((book) => book.book_id)
	});
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await page.locator('.recent-selections a').first().click();
	await expect(page.locator('.history-error')).toHaveText(
		'The saved selection failed. We have noted this error and it will be addressed.'
	);
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await expect(page).not.toHaveURL(/request_id/);
	expect(state.posts).toHaveLength(1);
});

for (const viewport of [
	{ width: 1280, height: 900 },
	{ width: 390, height: 844 }
]) {
	for (const historyMode of ['rank_selection', 'recommend_from_selection']) {
		test(`history holds picker until commit and restores it with one scroll at ${viewport.width}px / ${historyMode}`, async ({
			page
		}) => {
			await page.setViewportSize(viewport);
			const state = await setup(page, 50);
			await mockStripCovers(page);
			state.status = 'completed';
			state.runId = 'HistoryA1';
			state.posts.push({
				request_type: historyMode,
				book_ids: books.slice(5, 13).map((book) => book.book_id)
			});
			await page.goto(`${base}/choose-books?from=bookmarks`);
			await expect(page.locator('.selection-tools > span')).toHaveText('48 books selected');
			await page.getByRole('button', { name: 'Show more books', exact: true }).click();
			const recent = page.locator('.recent-selections');
			const link = recent.getByRole('link').first();
			await expect(link).toHaveAttribute(
				'href',
				new RegExp(`mode=${historyMode}&request_id=HistoryA1`)
			);
			await link.scrollIntoViewIfNeeded();
			const picker = await page.locator('.selection-editor').elementHandle();
			const recentNode = await recent.elementHandle();
			const before = await page.evaluate(() => ({
				y: scrollY,
				height: document.documentElement.scrollHeight,
				cards: document.querySelectorAll('.candidate-grid li').length,
				strip: document.querySelector('.cover-strip')?.scrollLeft
			}));
			const sourceReads: string[] = [];
			page.on('request', (request) => {
				if (
					/\/api\/(bookmarks|recommendations\/unique|recommendations\/count)(\?|$)/.test(
						request.url()
					)
				)
					sourceReads.push(request.url());
			});
			let release = () => {};
			const held = new Promise<void>((done) => {
				release = done;
			});
			await page.route(
				(url) => url.pathname === '/api/recommendations' && url.searchParams.has('request_id'),
				async (route) => {
					await held;
					await route.fallback();
				}
			);
			await page.evaluate(() => {
				const w = window as typeof window & { resultScrolls: number };
				w.resultScrolls = 0;
				const original = Element.prototype.scrollIntoView;
				Element.prototype.scrollIntoView = function (...args) {
					if (this.matches('.selection-results')) w.resultScrolls++;
					return original.apply(this, args);
				};
			});
			await link.click();
			try {
				await expect(link).toHaveAttribute('aria-busy', 'true');
				await expect(link).toContainText('Loading selection…');
				await expect(page).not.toHaveURL(/request_id/);
				await expect(page.locator('.selection-action button')).toHaveText('Rank my list');
				await expect(page.locator('.mode-tabs button').first()).toHaveAttribute(
					'aria-pressed',
					'true'
				);
				const during = await page.evaluate(() => ({
					y: scrollY,
					height: document.documentElement.scrollHeight,
					cards: document.querySelectorAll('.candidate-grid li').length
				}));
				expect(during).toEqual({ y: before.y, height: before.height, cards: before.cards });
				expect(await picker!.evaluate((node) => node.isConnected)).toBe(true);
				expect(await recentNode!.evaluate((node) => node.isConnected)).toBe(true);
				expect(
					await page.evaluate(
						(key) => sessionStorage.getItem(key),
						`unread:selection-pending:v1:${userId}`
					)
				).toBeNull();
			} finally {
				release();
			}
			await expect(page.locator('.selection-results')).toBeVisible();
			await expect(page).toHaveURL(/request_id=HistoryA1/);
			await expect(page.locator('.selection-results')).toBeFocused();
			expect(
				await page.evaluate(
					() => (window as typeof window & { resultScrolls: number }).resultScrolls
				)
			).toBe(1);
			expect(sourceReads).toEqual([]);
			const resultY = await page.evaluate(() => scrollY);
			await page.goBack();
			await expect(page.locator('.selection-editor')).toBeVisible();
			await expect(link).toBeFocused();
			await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before.y, 0);
			await expect(page.locator('.candidate-grid li')).toHaveCount(before.cards);
			await expect
				.poll(() => page.locator('.cover-strip').evaluate((node) => node.scrollLeft))
				.toBeCloseTo(before.strip!, 0);
			await expect(page.getByRole('button', { name: 'Bookmarks', exact: true })).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			await page.goForward();
			await expect(page.locator('.selection-results')).toBeVisible();
			await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(resultY, 0);
			await page.getByRole('button', { name: 'Back to selection', exact: true }).click();
			await expect(page.locator('.selection-editor')).toBeVisible();
			await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before.y, 0);
			// Cached repeat uses the same commit path, with no result transport.
			const reads = state.resultReads;
			await link.click();
			await expect(page.locator('.selection-results')).toBeVisible();
			expect(state.resultReads).toBe(reads);
			expect(await page.evaluate(() => scrollY)).toBeCloseTo(resultY, 0);
			expect(
				await page.evaluate(
					() => (window as typeof window & { resultScrolls: number }).resultScrolls
				)
			).toBe(2);
		});
	}
}

test('history failures stay on the picker and choosing another saved list is read-only', async ({
	page
}) => {
	const state = await setup(page, 20);
	await mockStripCovers(page);
	state.status = 'completed';
	state.posts.push({
		request_type: 'rank_selection',
		book_ids: books.slice(2, 10).map((book) => book.book_id)
	});
	await page.route(
		(url) =>
			url.pathname === '/api/recommendations/selection' && !url.searchParams.has('request_id'),
		(route) =>
			route.fulfill({
				json: {
					requests: [
						{
							public_id: 'FailedA1',
							request_type: 'rank_selection',
							book_ids: books.slice(2, 10).map((book) => book.book_id),
							status: 'completed',
							created_at: '2026-11-01'
						},
						{
							public_id: 'ChooseA1',
							request_type: 'rank_selection',
							book_ids: books.slice(2, 10).map((book) => book.book_id),
							status: 'completed',
							created_at: '2026-11-02'
						}
					]
				}
			})
	);
	await page.route(
		(url) =>
			url.pathname === '/api/recommendations/selection' &&
			url.searchParams.get('request_id') === 'FailedA1',
		(route) => route.fulfill({ status: 503, json: { message: 'Unavailable' } })
	);
	await page.goto(`${base}/choose-books?from=bookmarks`);
	const links = page.locator('.recent-selections a');
	await links.first().click();
	await expect(page.locator('.history-error')).toContainText('Could not load');
	await expect(page.locator('.selection-editor')).toBeVisible();
	await expect(page).not.toHaveURL(/request_id/);
	await links.nth(1).click();
	await expect(page.locator('.selection-results')).toBeVisible();
	await expect(page).toHaveURL(/request_id=ChooseA1/);
	await expect(page.locator('.selection-results')).toBeFocused();
	expect(state.posts).toHaveLength(1);
});

test('history retry preserves catalog search and cancels an obsolete historical read', async ({
	page
}) => {
	const state = await setup(page, 20);
	await mockStripCovers(page);
	state.status = 'completed';
	state.posts.push({
		request_type: 'rank_selection',
		book_ids: books.slice(2, 10).map((book) => book.book_id)
	});
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await page.getByRole('button', { name: 'All books', exact: true }).click();
	await page.getByRole('searchbox').fill('Selection');
	await expect(page.locator('.candidate-grid li')).toHaveCount(8);
	const searchCards = await page.locator('.candidate-grid').elementHandle();
	const link = page.locator('.recent-selections a').first();
	let fail = true;
	let release = () => {};
	const held = new Promise<void>((done) => {
		release = done;
	});
	await page.route(
		(url) =>
			url.pathname === '/api/recommendations/selection' && url.searchParams.has('request_id'),
		async (route) => {
			if (fail) {
				await route.fulfill({ status: 503, json: { message: 'Unavailable' } });
				return;
			}
			await held;
			try {
				await route.fallback();
			} catch {
				/* The obsolete request was cancelled. */
			}
		}
	);
	await link.click();
	await expect(link).toContainText('Retry');
	await expect(page.getByRole('searchbox')).toHaveValue('Selection');
	fail = false;
	await link.click();
	await expect(link).toHaveAttribute('aria-busy', 'true');
	// Changing the selection cancels history loading rather than replacing the reader's edit later.
	await page
		.locator('.candidate-grid')
		.getByRole('button', { name: 'Add Selection Book 0', exact: true })
		.click();
	await expect(link).not.toHaveAttribute('aria-busy');
	release();
	await expect(page.locator('.selection-editor')).toBeVisible();
	await expect(page).not.toHaveURL(/request_id/);
	await link.click();
	await expect(page.locator('.selection-results')).toBeVisible();
	await page.getByRole('button', { name: 'Back to selection', exact: true }).click();
	await expect(page.getByRole('searchbox')).toHaveValue('Selection');
	await expect(page.locator('.candidate-grid li')).toHaveCount(8);
	expect(await searchCards!.evaluate((node) => node.isConnected)).toBe(true);
	await expect(page.locator('.selection-tools > span')).toHaveText('19 books selected');
	expect(state.posts).toHaveLength(1);
});

test('a processing historical run stays read-only and updates only its row until completed', async ({
	page
}) => {
	const state = await setup(page, 10);
	await mockStripCovers(page);
	state.posts.push({
		request_type: 'recommend_from_selection',
		book_ids: books.slice(2, 10).map((book) => book.book_id)
	});
	await page.goto(`${base}/choose-books?from=bookmarks`);
	const link = page.locator('.recent-selections a').first();
	await link.click();
	await expect(link).toHaveAttribute('aria-busy', 'true');
	await expect(page.locator('.selection-action button')).toHaveText('Rank my list');
	await expect(page.locator('.selection-editor')).toBeVisible();
	expect(state.resultReads).toBe(0);
	state.status = 'completed';
	await expect(page.locator('.selection-results')).toBeVisible();
	await expect(page.locator('.mode-tabs button').nth(1)).toHaveAttribute('aria-pressed', 'true');
	expect(state.posts).toHaveLength(1);
	expect(
		await page.evaluate(
			(key) => sessionStorage.getItem(key),
			`unread:selection-pending:v1:${userId}`
		)
	).toBeNull();
});

test('bookmarks preselect unread books; editing survives refresh and mode switches without bookshelf writes', async ({
	page
}) => {
	const state = await setup(page);
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await expect(page).toHaveURL(/mode=rank_selection/);
	await page.getByRole('button', { name: 'Remove Selection Book 2', exact: true }).click();
	await expect(page.locator('.selection-tools > span')).toHaveText('7 books selected');
	await page.reload();
	await expect(page.locator('.selection-tools > span')).toHaveText('7 books selected');
	await page.getByRole('button', { name: 'Find more like these', exact: true }).click();
	await expect(page.locator('.selection-tools > span')).toHaveText('0 books selected');
	await page
		.locator('.mode-tabs')
		.getByRole('button', { name: 'Rank my list', exact: true })
		.click();
	await expect(page.locator('.selection-tools > span')).toHaveText('7 books selected');
	expect(state.posts).toHaveLength(0);
	expect(state.writes).toBe(0);
});

test('sources combine without duplicates; catalog search allows explicit read and dismissed choices in both modes', async ({
	page
}) => {
	const state = await setup(page);
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await page.getByRole('button', { name: 'Previous recommendations', exact: true }).click();
	await page.getByRole('button', { name: 'Add all previous recommendations' }).click();
	await expect(page.locator('.selection-tools > span')).toHaveText('13 books selected');
	await page.getByRole('button', { name: 'All books', exact: true }).click();
	await page.getByRole('searchbox', { name: 'Search books to select' }).fill('Selection');
	await expect(
		page.getByRole('button', { name: 'Selection Book 2 selected', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Add Selection Book 0', exact: true }).click();
	await page.getByRole('button', { name: 'Add Selection Book 1', exact: true }).click();
	await expect(
		page.locator('[data-copy="1"] .selected-book.dismissed:not([aria-hidden])')
	).toHaveCount(1);
	await expect(page.locator('.candidate-grid li.dismissed')).toHaveCount(1);
	await expect(page.locator('.selection-tools > span')).toHaveText('15 books selected');
	await page.getByRole('button', { name: 'Find more like these', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Add Selection Book 0', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Add Selection Book 0', exact: true }).click();
	await expect(page.locator('.selection-tools > span')).toHaveText('1 book selected');
	expect(state.writes).toBe(0);
});

test('200-book cap retains access to the remaining source and uses a keyboard-scrollable strip', async ({
	page
}) => {
	await setup(page, 215);
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await expect(page.locator('.selection-tools > span')).toHaveText('200 / 200 books selected');
	await expect(
		page.getByText('Selected 200 most recently bookmarked unrated books.')
	).toBeVisible();
	const strip = page.getByRole('region', { name: 'Selected books' });
	await strip.focus();
	await page.keyboard.press('End');
	await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
	await expect(page.getByRole('button', { name: /Scroll selected books/ })).toHaveCount(0);
	expect(await strip.evaluate((element) => getComputedStyle(element).scrollbarWidth)).toBe('none');
	await strip.hover();
	await page.mouse.wheel(600, 0);
	await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
	const frames = await strip.evaluate(async (element) => {
		await new Promise<void>((finish) =>
			requestAnimationFrame(() => requestAnimationFrame(() => finish()))
		);
		const gaps: number[] = [];
		let previous = performance.now();
		await new Promise<void>((finish) => {
			const frame = (now: number) => {
				gaps.push(now - previous);
				previous = now;
				if (gaps.length < 30) requestAnimationFrame(frame);
				else finish();
			};
			requestAnimationFrame(frame);
		});
		const ordered = [...gaps].sort((a, b) => a - b);
		return {
			samples: gaps.length,
			medianMs: ordered[Math.floor(ordered.length / 2)],
			p95Ms: ordered[Math.floor(ordered.length * 0.95)],
			scrollLeft: element.scrollLeft
		};
	});
	await test.info().attach('native-scroll-frame-times.json', {
		body: JSON.stringify(frames),
		contentType: 'application/json'
	});
	await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
	await page.getByRole('searchbox').fill('Selection Book 214');
	await expect(
		page.getByRole('button', { name: 'Add Selection Book 214', exact: true })
	).toBeDisabled();
	await page.getByRole('button', { name: 'Remove Selection Book 201', exact: true }).click();
	await page.getByRole('button', { name: 'Add Selection Book 214', exact: true }).click();
	await expect(page.locator('.selection-tools > span')).toHaveText('200 / 200 books selected');
});

test('submits one immutable request, waits for completion, shows all 10, and restores results on reload', async ({
	page
}, info) => {
	const state = await setup(page, 12);
	await page.goto(`${base}/choose-books?from=bookmarks`);
	const submit = page
		.locator('.selection-action')
		.getByRole('button', { name: 'Rank my list', exact: true });
	await expect(submit).toBeEnabled();
	await submit.dblclick();
	await expect(page).toHaveURL(/request_id=ChooseA1/);
	await expect(page.locator('.selection-action button')).toHaveText('Ranking your list…');
	await expect(page.locator('.selection-action button')).toBeDisabled();
	await expect(page.locator('.cover-strip')).toBeVisible();
	await expect(page.getByRole('searchbox')).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Bookmarks', exact: true })).toBeDisabled();
	await expect(page.locator('.mode-tabs button').first()).toBeDisabled();
	await expect(
		page.getByRole('button', { name: 'Remove Selection Book 2', exact: true })
	).toBeDisabled();
	await expect(
		page.getByRole('button', { name: 'Clear entire selection', exact: true })
	).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Back to selection' })).toHaveCount(0);
	await expect(page.locator('.request-notice')).toHaveCount(0);
	expect(state.posts).toHaveLength(1);
	expect(state.posts[0]).toEqual({
		request_type: 'rank_selection',
		book_ids: books.slice(2, 12).map((book) => book.book_id)
	});
	expect(state.resultReads).toBe(0);
	state.status = 'completed';
	await expect(page.getByRole('region', { name: 'Recommendations', exact: true })).toBeVisible({
		timeout: 12_000
	});
	await expect(page.locator('.selection-results ol > li')).toHaveCount(10);
	await expect(page.locator('.selection-stage')).toBeHidden();
	await expect(page.locator('.book-browser')).toBeHidden();
	await expect(page.getByRole('region', { name: 'Recommendations', exact: true })).toBeFocused();
	await page.reload();
	await expect(page.getByRole('region', { name: 'Recommendations', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Back to selection' }).click();
	await expect(page.locator('.selection-tools > span')).toHaveText('10 books selected');
	await expect(page.getByRole('searchbox')).toHaveValue('');
	await expect(page.getByRole('button', { name: 'All books', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.locator('.selection-action button').click();
	await expect(page.locator('.selection-results ol > li')).toHaveCount(10);
	await page.getByRole('button', { name: 'Back to selection' }).click();
	await page.screenshot({ path: info.outputPath('desktop-selection.png'), fullPage: true });
	expect(state.posts).toHaveLength(1);
});

for (const mode of ['rank_selection', 'recommend_from_selection']) {
	test(`recent selections stay visible but cannot navigate while ${mode} is running`, async ({
		page
	}) => {
		const state = await setup(page);
		await page.route(
			(url) =>
				url.pathname === '/api/recommendations/selection' && !url.searchParams.has('request_id'),
			(route) =>
				route.request().method() === 'POST'
					? route.fallback()
					: route.fulfill({
							json: {
								requests: [
									{
										public_id: 'PreviousA1',
										request_type: 'rank_selection',
										book_ids: books.slice(2, 10).map((book) => book.book_id),
										status: 'completed',
										result_count: 8,
										error_code: null,
										created_at: '2026-11-01T12:00:00Z'
									}
								]
							}
						})
		);
		await page.goto(`${base}/choose-books?from=bookmarks&mode=${mode}`);
		const recent = page.locator('.recent-selections');
		await expect(recent).toBeVisible();
		await expect(recent.locator('li')).toHaveCount(1);
		const historicalResult = recent.getByRole('link');
		await expect(historicalResult).toBeEnabled();
		await expect(historicalResult).toHaveAttribute('href', /request_id=PreviousA1/);
		const content = await recent.textContent();
		const element = await recent.elementHandle();
		const measure = () =>
			recent.evaluate((node) => ({
				top: node.getBoundingClientRect().top + window.scrollY,
				height: node.getBoundingClientRect().height
			}));
		const before = await measure();
		await page.locator('.selection-action button').click();
		await expect(page).toHaveURL(/request_id=ChooseA1/);
		await expect(page.locator('.selection-action button')).toHaveText(
			mode === 'rank_selection' ? 'Ranking your list…' : 'Finding more books…'
		);
		await expect(recent).toBeVisible();
		expect(await element!.evaluate((node) => node.isConnected)).toBe(true);
		expect(await recent.textContent()).toBe(content);
		const after = await measure();
		expect(after.top).toBeCloseTo(before.top, 0);
		expect(after.height).toBeCloseTo(before.height, 0);
		await expect(historicalResult).toBeDisabled();
		await expect(historicalResult).not.toHaveAttribute('href');
		await expect(historicalResult).toHaveAttribute('tabindex', '-1');
		await historicalResult.dispatchEvent('click');
		await historicalResult.evaluate((node) => node.focus());
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/request_id=ChooseA1/);
		expect(state.posts).toHaveLength(1);
		state.status = mode === 'rank_selection' ? 'completed' : 'failed';
		if (state.status === 'completed') {
			await expect(page.locator('.selection-results ol > li')).toHaveCount(8);
		} else {
			await expect(page.locator('.selection-action button')).toHaveText('Error: Failed. Retry');
		}
		await expect(historicalResult).toBeEnabled();
		await expect(historicalResult).toHaveAttribute('href', /request_id=PreviousA1/);
		await expect(historicalResult).not.toHaveAttribute('tabindex');
		await Promise.all([
			page.waitForRequest((request) => {
				const url = new URL(request.url());
				return (
					url.pathname === '/api/recommendations/selection' &&
					url.searchParams.get('request_id') === 'PreviousA1'
				);
			}),
			historicalResult.click()
		]);
	});
}

test('ambiguous submission stays guarded through refresh and recovers its original request', async ({
	page
}) => {
	const state = await setup(page);
	state.uncertain = true;
	state.holdRecent = true;
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await page
		.locator('.selection-action')
		.getByRole('button', { name: 'Rank my list', exact: true })
		.click();
	await expect(page.locator('.selection-action button')).toHaveText('Reconnecting…');
	await page.reload();
	await expect(page.locator('.selection-action button')).toBeDisabled();
	state.holdRecent = false;
	await expect(page).toHaveURL(/request_id=ChooseA1/);
	expect(state.posts).toHaveLength(1);
});

test('slow work times out at the original deadline after refresh and Retry submits a new job', async ({
	page
}) => {
	const state = await setup(page);
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await page.locator('.selection-action button').click();
	await expect(page).toHaveURL(/request_id=ChooseA1/);
	const originalSince = await page.evaluate(
		(userId) => JSON.parse(sessionStorage.getItem(`unread:selection-pending:v1:${userId}`)!).since,
		userId
	);
	await expect(page.locator('.selection-action button')).toHaveText('Still working…', {
		timeout: 6000
	});
	await page.reload();
	await expect(page.locator('.selection-action button')).toBeDisabled();
	expect(
		await page.evaluate(
			(userId) =>
				JSON.parse(sessionStorage.getItem(`unread:selection-pending:v1:${userId}`)!).since,
			userId
		)
	).toBe(originalSince);
	await expect(page.locator('.selection-action button')).toHaveText('Error: Timed out. Retry', {
		timeout: 7500
	});
	expect(await page.evaluate((since) => Date.now() - since, originalSince)).toBeLessThan(12_500);
	await expect(page.locator('.selection-action button')).toBeEnabled();
	await expect(page.getByRole('searchbox')).toBeEnabled();
	await expect(page.locator('.mode-tabs button').last()).toBeEnabled();
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	state.runId = 'ChooseB2';
	state.status = 'completed';
	await page.locator('.selection-action button').click();
	await expect(page.locator('.selection-results ol > li')).toHaveCount(8);
	expect(state.posts).toHaveLength(2);
	expect(state.posts[1]).toEqual(state.posts[0]);
});

test('same-tab navigation resumes the active job and locks the other mode', async ({ page }) => {
	const state = await setup(page);
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await page.locator('.selection-action button').click();
	await expect(page).toHaveURL(/request_id=ChooseA1/);
	await page.goto(`${base}/choose-books?mode=recommend_from_selection`);
	await expect(page.locator('.selection-action button')).toHaveText('Ranking your list…');
	await expect(page.locator('.mode-tabs button').last()).toBeDisabled();
	state.status = 'completed';
	await expect(page.locator('.selection-results ol > li')).toHaveCount(8);
	expect(state.posts).toHaveLength(1);
});

test('only the latest completed selection is reused and reordered inputs still match', async ({
	page
}) => {
	const state = await setup(page);
	state.status = 'completed';
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await page.locator('.selection-action button').click();
	await expect(page.locator('.selection-results ol > li')).toHaveCount(8);
	await page.getByRole('button', { name: 'Back to selection' }).click();
	await page.getByRole('button', { name: 'Remove Selection Book 2', exact: true }).click();
	await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
	await page.getByRole('button', { name: 'Add Selection Book 2', exact: true }).click();
	await page.locator('.selection-action button').click();
	await expect(page.locator('.selection-results ol > li')).toHaveCount(8);
	expect(state.posts).toHaveLength(1);
	await page.getByRole('button', { name: 'Back to selection' }).click();
	await expect(page.locator('[data-copy="1"] .remove-book').last()).toHaveAttribute(
		'aria-label',
		'Remove Selection Book 2'
	);
	await page.getByRole('button', { name: 'Remove Selection Book 3', exact: true }).click();
	state.runId = 'ChooseB2';
	await page.locator('.selection-action button').click();
	await expect(page.locator('.selection-results ol > li')).toHaveCount(7);
	expect(state.posts).toHaveLength(2);
	await page.getByRole('button', { name: 'Back to selection' }).click();
	await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
	await page.getByRole('button', { name: 'Add Selection Book 3', exact: true }).click();
	state.runId = 'ChooseC3';
	await page.locator('.selection-action button').click();
	await expect(page.locator('.selection-results ol > li')).toHaveCount(8);
	expect(state.posts).toHaveLength(3);
});

test('empty completed results replace the picker and offer Back to selection', async ({ page }) => {
	const state = await setup(page);
	state.status = 'completed';
	state.resultCount = 0;
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await page.locator('.selection-action button').click();
	await expect(
		page.getByText('No matches found. We have noted this error and it will be addressed.')
	).toBeVisible();
	await expect(page.locator('.book-browser')).toBeHidden();
	await page.getByRole('button', { name: 'Back to selection' }).click();
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await page.locator('.selection-action button').click();
	await expect(page.getByRole('button', { name: 'Back to selection' })).toBeVisible();
	expect(state.posts).toHaveLength(1);
});

test('mobile liked-books flow enforces the minimum and submits the inspiration mode', async ({
	page
}, info) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = await setup(page);
	await page.goto(`${base}/choose-books?mode=recommend_from_selection`);
	await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
	for (const i of [0, 1, 2])
		await page.getByRole('button', { name: `Add Selection Book ${i}`, exact: true }).click();
	const submit = page
		.locator('.selection-action')
		.getByRole('button', { name: 'Find more like these', exact: true });
	await expect(submit).toBeDisabled();
	await page.getByRole('button', { name: 'Add Selection Book 3', exact: true }).click();
	await expect(submit).toBeEnabled();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: info.outputPath('mobile-selection.png'), fullPage: true });
	await submit.click();
	await expect(page).toHaveURL(/request_id=ChooseA1/);
	expect(state.posts[0]).toEqual({
		request_type: 'recommend_from_selection',
		book_ids: books.slice(0, 4).map((book) => book.book_id)
	});
	expect(state.writes).toBe(0);
});

test('no usable books explains recovery while preserving all original inputs', async ({ page }) => {
	const state = await setup(page);
	state.status = 'failed';
	state.missing = true;
	state.errorCode = 'no_usable_selection';
	await page.goto(`${base}/choose-books?request_id=ChooseA1`);
	await expect(page.getByRole('button', { name: 'Back to selection' })).toHaveCount(0);
	await expect(
		page.getByRole('button', { name: 'Remove Unavailable book', exact: true })
	).toBeVisible();
	await expect(
		page.getByText(
			'None of the chosen books are available for recommendations. We have noted this error and it will be addressed.'
		)
	).toBeVisible();
	await expect(
		page
			.locator('.selection-action')
			.getByRole('button', { name: 'Error: Failed. Retry', exact: true })
	).toBeEnabled();
	await page.getByRole('button', { name: 'Remove Unavailable book', exact: true }).click();
	await expect(
		page.locator('.selection-action').getByRole('button', { name: 'Rank my list', exact: true })
	).toBeEnabled();
});

test('failed source loading offers retry without automatically submitting', async ({ page }) => {
	const state = await setup(page);
	state.failSource = true;
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await expect(page.locator('.browser-state [role="alert"]')).toContainText(
		'Could not load your bookmarks.',
		{ timeout: 20_000 }
	);
	state.failSource = false;
	await page.locator('.browser-state').getByRole('button', { name: 'Retry', exact: true }).click();
	await page.getByRole('button', { name: 'Add all Bookmarks' }).click();
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	expect(state.posts).toHaveLength(0);
});

test('partial success shows ordinary results and restores every original input', async ({
	page
}) => {
	const state = await setup(page);
	state.status = 'completed';
	state.skipped = [books[2].book_id];
	state.resultCount = 7;
	state.missing = true;
	await page.goto(`${base}/choose-books?request_id=ChooseA1`);
	await expect(page.getByRole('region', { name: 'Recommendations', exact: true })).toBeVisible();
	await expect(page.locator('.selection-results ol > li')).toHaveCount(8);
	await expect(page.getByText(/couldn.t be used|unsupported|skipped/i)).toHaveCount(0);
	await page.getByRole('button', { name: 'Back to selection', exact: true }).click();
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await expect(
		page.locator('.selection-action').getByRole('button', { name: 'Rank my list', exact: true })
	).toBeEnabled();
	expect(state.posts).toHaveLength(0);
});

test('ranking keeps explicit read and dismissed results without changing saved actions', async ({
	page
}) => {
	const state = await setup(page);
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await page.getByRole('button', { name: 'Add Selection Book 0', exact: true }).click();
	await page.getByRole('button', { name: 'Add Selection Book 1', exact: true }).click();
	state.status = 'completed';
	await page
		.locator('.selection-action')
		.getByRole('button', { name: 'Rank my list', exact: true })
		.click();
	await expect(page.getByRole('region', { name: 'Recommendations', exact: true })).toBeVisible();
	await expect(page.locator('.selection-results .book-card').first()).toContainText(
		'Selection Book 0'
	);
	await expect(page.locator('.selection-results .book-card').nth(1)).toContainText(
		'Selection Book 1'
	);
	expect(state.writes).toBe(0);
});

test('inspiration evidence retains an unrated seed and names its selection origin', async ({
	page
}) => {
	const state = await setup(page);
	await page.goto(`${base}/choose-books?mode=recommend_from_selection`);
	await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
	for (const i of [0, 1, 2, 3])
		await page.getByRole('button', { name: `Add Selection Book ${i}`, exact: true }).click();
	state.status = 'completed';
	await page
		.locator('.selection-action')
		.getByRole('button', { name: 'Find more like these', exact: true })
		.click();
	await expect(page.getByText('Based on books you selected:')).toBeVisible();
	await expect(page.locator('.recommendation-precedents button')).toHaveCount(1);
	expect(state.writes).toBe(0);
});

test('unsupported selection links through the grouped shortlist return 404', async ({ page }) => {
	const state = await setup(page);
	state.status = 'completed';
	await page.route('**/api/recommendations?**', async (route) => {
		const url = new URL(route.request().url());
		if (url.searchParams.get('request_id') === 'ChooseA1')
			return route.fulfill({ status: 404, json: { message: 'Not found' } });
		return route.fallback();
	});
	await page.goto(`${base}/rate/recommendations/shortlist?request_id=ChooseA1&from=history`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(page).toHaveTitle(/^404 /, { timeout: 15000 });
	await expect(page).toHaveURL(/shortlist\?request_id=ChooseA1/);
});

test('clear offers undo, restores the exact selection and keeps each mode independent', async ({
	page
}) => {
	const state = await setup(page);
	await page.goto(`${base}/choose-books?from=bookmarks`);
	const count = page.locator('.selection-tools > span');
	await expect(count).toHaveText('8 books selected');
	await expect(page.getByRole('button', { name: /^Remove Selection Book/ })).toHaveCount(8);
	const original = books.slice(2, 10).map((book) => `Remove ${book.title}`);
	await page.getByRole('button', { name: 'Clear entire selection', exact: true }).click();
	await expect(count).toHaveText('0 books selected');
	await expect(page.getByRole('button', { name: 'Undo clear', exact: true })).toBeFocused();
	await expect(
		page.getByText(
			'Search for books or add your bookmarks and previous recommendations for consideration.',
			{
				exact: true
			}
		)
	).toHaveCount(1);
	await page.getByRole('button', { name: 'Find more like these', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Undo clear', exact: true })).toHaveCount(0);
	await page
		.locator('.mode-tabs')
		.getByRole('button', { name: 'Rank my list', exact: true })
		.click();
	await page.getByRole('button', { name: 'Undo clear', exact: true }).click();
	await expect(count).toHaveText('8 books selected');
	await expect
		.poll(() =>
			page
				.getByRole('button', { name: /^Remove Selection Book/ })
				.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
		)
		.toEqual(original);
	await page.getByRole('button', { name: 'All books', exact: true }).click();
	await expect(page.getByText('Search results', { exact: true })).toHaveCount(0);
	await expect(
		page.getByText('Recommendations will come only from this selection.', { exact: true })
	).toHaveCount(0);
	await expect(page.getByText('Build your selection', { exact: true })).toHaveCount(0);
	await expect(page.locator('h1:not(.sr-only)')).toHaveCount(0);
	await expect(page.locator('.book-browser .browser-empty')).toHaveCount(0);
	expect(state.writes).toBe(0);
});

for (const mode of ['rank_selection', 'recommend_from_selection']) {
	for (const viewport of [
		{ width: 1280, height: 900 },
		{ width: 390, height: 844 }
	]) {
		test(`fitted covers stay unique; overflow supports drag and looping in ${mode} at ${viewport.width}px`, async ({
			page
		}) => {
			await page.setViewportSize(viewport);
			const state = await setup(page, 3);
			await page.route('**/*.avif', (route) =>
				route.fulfill({
					contentType: 'image/svg+xml',
					body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#e5ddcd"/><text x="14" y="42" fill="#152020" font-size="18">Full book cover</text></svg>'
				})
			);
			await page.goto(`${base}/choose-books?from=bookmarks&mode=${mode}`);
			const strip = page.getByRole('region', { name: 'Selected books', exact: true });
			await expect(page.locator('.selection-tools > span')).toHaveText('1 book selected');
			await expect(strip).not.toHaveClass(/scrollable/);
			await expect(strip.locator('.selected-book')).toHaveCount(1);
			await expect
				.poll(() =>
					strip
						.locator('[data-copy="1"] img')
						.first()
						.evaluate(
							(img) =>
								(img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0
						)
				)
				.toBe(true);
			await strip.hover();
			const fitCount = await strip.evaluate((element) => {
				const card = element.querySelector<HTMLElement>('.selected-book')!;
				return Math.floor(
					(element.clientWidth - 44 - 24) / (parseFloat(getComputedStyle(card).width) - 24)
				);
			});
			const drag = async () => {
				const bounds = await strip.boundingBox();
				if (!bounds) throw new Error('Selection strip is not visible');
				await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height / 2);
				await page.mouse.down();
				await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height / 2, {
					steps: 12
				});
				await page.mouse.up();
			};
			await drag();
			expect(await strip.evaluate((element) => element.scrollLeft)).toBe(0);
			await strip.focus();
			await page.keyboard.press('Tab');
			await expect(
				strip.getByRole('button', {
					name: 'Selection Book 2 by Test Author. See summary',
					exact: true
				})
			).toBeFocused();
			await page.keyboard.press('Tab');
			await expect(
				strip.getByRole('button', { name: 'Remove Selection Book 2', exact: true })
			).toBeFocused();
			await page.keyboard.press('Tab');
			await expect(
				page.getByRole('button', { name: 'Clear entire selection', exact: true })
			).toBeFocused();
			await page.getByRole('button', { name: 'Previous recommendations', exact: true }).click();
			await page
				.getByRole('button', { name: 'Add all previous recommendations', exact: true })
				.click();
			await expect(page.locator('.selection-tools > span')).toHaveText('11 books selected');
			const toolbar = await page.locator('.selection-toolbar').boundingBox();
			const tools = await page.locator('.selection-tools').boundingBox();
			const action = await page.locator('.selection-action').boundingBox();
			expect(Math.abs(tools!.y + tools!.height / 2 - action!.y - action!.height / 2)).toBeLessThan(
				2
			);
			expect(Math.abs(action!.x + action!.width - toolbar!.x - toolbar!.width)).toBeLessThan(2);
			expect(tools!.x + tools!.width).toBeLessThan(action!.x);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true
			);
			await expect(strip).toHaveClass(/scrollable/);
			await expect(strip).toHaveClass(/looping/);
			await strip.hover();
			const start = await strip.evaluate((element) => element.scrollLeft);
			await drag();
			await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).not.toBe(start);
			await expect(strip).not.toHaveClass(/dragging/);
			await expect(strip.getByRole('button', { name: /^Remove/ })).toHaveCount(11);
			const checkSeams = async () => {
				await expect(strip).toHaveClass(/looping/);
				await expect(strip.locator('.cover-cycle')).toHaveCount(4);
				for (const direction of [1, -1]) {
					const position = await strip.evaluate(async (element, direction) => {
						const width = element
							.querySelector<HTMLElement>('[data-copy="1"]')!
							.getBoundingClientRect().width;
						element.scrollTo({
							left: direction === 1 ? width * 2 + 40 : width - 40,
							behavior: 'instant'
						});
						await new Promise<void>((resolve) =>
							requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
						);
						const bounds = element.getBoundingClientRect();
						const cards = [...element.querySelectorAll<HTMLElement>('.selected-book')];
						const visible = cards
							.filter((card) => {
								const rect = card.getBoundingClientRect();
								return rect.right > bounds.left + 1 && rect.left < bounds.right - 1;
							})
							.map((card) => Number(card.dataset.index));
						const fullyVisible = cards
							.filter((card) => {
								const rect = card.querySelector('.cover-hit')!.getBoundingClientRect();
								return rect.left >= bounds.left && rect.right <= bounds.right;
							})
							.map((card) => card.dataset.bookId);
						return {
							left: element.scrollLeft,
							expected: direction === 1 ? width + 40 : width * 2 - 40,
							visible,
							fullyVisible,
							count: element.querySelectorAll('[data-copy="1"] .selected-book').length
						};
					}, direction);
					expect(Math.abs(position.left - position.expected)).toBeLessThan(2);
					expect(position.visible.length).toBeGreaterThan(0);
					// Partial jackets may wrap across the faded edges, but never duplicate
					// a whole jacket or interrupt the cyclic left-to-right selection order.
					expect(new Set(position.fullyVisible).size).toBe(position.fullyVisible.length);
					for (let index = 1; index < position.visible.length; index++)
						expect(position.visible[index]).toBe(
							(position.visible[index - 1] + 1) % position.count
						);
				}
			};
			await checkSeams();
			// The tightest overflow must wrap in both directions too, without resizing.
			for (let count = 11; count > fitCount + 1; count--)
				await strip
					.getByRole('button', { name: /^Remove/ })
					.last()
					.click();
			await expect(strip).toHaveClass(/scrollable/);
			await expect(strip).toHaveClass(/looping/);
			await strip.hover();
			await checkSeams();
			await strip
				.getByRole('button', { name: /^Remove/ })
				.last()
				.click();
			await expect(strip).not.toHaveClass(/scrollable/);
			await expect(strip.locator('.selected-book')).toHaveCount(fitCount);
			await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBe(0);
			expect(
				await strip.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
			).toBe(true);
			expect(state.writes).toBe(0);
		});
	}
	test(`search cards have breathing room and preserve uncropped covers in ${mode}`, async ({
		page
	}, info) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const state = await setup(page);
		state.longTitles = true;
		await page.route('**/*-200.avif', (route) =>
			route.fulfill({
				contentType: 'image/svg+xml',
				body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#e5ddcd"/><text x="14" y="42" fill="#152020" font-size="18">Full book cover</text></svg>'
			})
		);
		await page.goto(`${base}/choose-books?mode=${mode}`);
		await expect(page.getByRole('searchbox', { name: 'Search books to select' })).toHaveAttribute(
			'placeholder',
			'Search all books by title or author'
		);
		await page.getByRole('searchbox', { name: 'Search books to select' }).fill('Selection');
		await expect(page.locator('.candidate-grid li')).toHaveCount(8);
		const geometry = await page.evaluate(() => {
			const search = document.querySelector('.selection-search')!.getBoundingClientRect();
			const cards = [...document.querySelectorAll('.candidate-grid li')].map((card) =>
				card.getBoundingClientRect()
			);
			return { gap: cards[0].top - search.bottom, widths: cards.map((card) => card.width) };
		});
		expect(geometry.gap).toBeGreaterThanOrEqual(18);
		expect(geometry.widths.every((width) => width > 280)).toBe(true);
		const tallCard = page
			.locator('.candidate-grid li')
			.filter({ hasText: 'An Extended Title for Layout Testing' });
		await expect(tallCard).toHaveCount(1);
		const cover = tallCard.locator('.selection-cover');
		const coverBounds = await cover.boundingBox();
		expect(coverBounds!.height).toBeCloseTo(102, 0);
		expect(coverBounds!.width).toBeCloseTo(68, 0);
		await expect(cover.locator('img')).toHaveCSS('object-fit', 'contain');
		await expect(
			page.locator('.mode-tabs').getByRole('button', { name: 'Rank my list', exact: true })
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Help me choose', exact: true })).toHaveCount(0);
		await expect(page.getByText('Build your selection', { exact: true })).toHaveCount(0);
		await expect(page.locator('h1:not(.sr-only)')).toHaveCount(0);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			mode === 'rank_selection' ? 'Rank my list' : 'Find more like these'
		);
		await expect(
			page.getByText('Discover other books based only on these books.', { exact: true })
		).toHaveCount(0);
		const action = page.locator('.selection-action');
		await expect(action).not.toContainText(/books? selected/);
		await expect(
			action.getByRole('button', {
				name: mode === 'rank_selection' ? 'Rank my list' : 'Find more like these',
				exact: true
			})
		).toBeVisible();
		const actionBounds = await action.boundingBox();
		const browserBounds = await page.locator('.book-browser').boundingBox();
		expect(actionBounds!.y + actionBounds!.height).toBeLessThan(browserBounds!.y);
		for (const source of ['Bookmarks', 'Previous recommendations']) {
			await page.getByRole('button', { name: source, exact: true }).click();
			await expect(page.getByRole('searchbox', { name: 'Search books to select' })).toHaveAttribute(
				'placeholder',
				source === 'Bookmarks'
					? 'Search bookmarks by title or author'
					: 'Search previous recommendations by title or author'
			);
			await expect(
				page.getByRole('button', {
					name: source === 'Bookmarks' ? 'Add all Bookmarks' : 'Add all previous recommendations'
				})
			).toBeVisible();
			await expect(page.locator('.browser-meta > span')).toHaveCount(0);
		}
		await page.screenshot({ path: info.outputPath('search-spacing.png'), fullPage: true });
	});
}

for (const mode of ['rank_selection', 'recommend_from_selection']) {
	for (const viewport of [
		{ width: 1280, height: 900 },
		{ width: 390, height: 844 }
	]) {
		test(`strip height stays fixed when scrolling and looping switch on and off in ${mode} at ${viewport.width}px`, async ({
			page
		}) => {
			await page.setViewportSize(viewport);
			await setup(page, 3);
			await mockStripCovers(page);
			await page.goto(`${base}/choose-books?from=bookmarks&mode=${mode}`);
			const strip = page.getByRole('region', { name: 'Selected books', exact: true });
			await expect(page.locator('.selection-tools > span')).toHaveText('1 book selected');
			await expect(page).toHaveURL(new RegExp(`mode=${mode}$`));
			await expect(strip).not.toHaveClass(/scrollable/);
			const readSize = () =>
				strip.evaluate((element) => ({
					height: element.getBoundingClientRect().height,
					coverHeight: element.querySelector<HTMLElement>('.selection-cover.large')!.offsetHeight
				}));
			const initial = await readSize();
			await page.getByRole('button', { name: 'Previous recommendations', exact: true }).click();
			await page
				.getByRole('button', { name: 'Add all previous recommendations', exact: true })
				.click();
			await expect(strip).toHaveClass(/scrollable/);
			await expect(strip).toHaveClass(/looping/);
			expect(await readSize()).toEqual(initial);
			// Longer selections must keep the same dimensions, not toggle a second loop threshold.
			await page.getByRole('button', { name: 'All books', exact: true }).click();
			await page.getByRole('searchbox').fill('Selection');
			for (const index of [0, 1, 3, 4])
				await page
					.getByRole('button', { name: `Add Selection Book ${index}`, exact: true })
					.click();
			await expect(strip).toHaveClass(/looping/);
			expect(await readSize()).toEqual(initial);
			while ((await strip.locator('[data-copy="1"] .selected-book').count()) > 1) {
				await strip.locator('[data-copy="1"] .remove-book').last().click();
				expect(await readSize()).toEqual(initial);
				if (await strip.evaluate((element) => element.classList.contains('scrollable')))
					await expect(strip).toHaveClass(/looping/);
			}
			await expect(strip).not.toHaveClass(/scrollable|looping/);
			expect(await readSize()).toEqual(initial);
		});
	}
}

for (const summary of ['Complete synopsis from the catalog.', null]) {
	test(`panel opens before a slow catalog read and reuses resolved ${summary === null ? 'empty' : 'full'} details`, async ({
		page
	}) => {
		await setup(page, 10);
		await mockStripCovers(page);
		await page.goto(`${base}/choose-books?from=bookmarks`);
		await expect(page).toHaveURL(/mode=rank_selection$/);
		const cover = page.locator('[data-copy="1"] .cover-hit').nth(2);
		await expect(cover).toBeVisible();
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let detailReads = 0;
		await page.route('**/rest/v1/books?**', async (route) => {
			detailReads++;
			await held;
			await route.fulfill({ json: [{ ...books[4], book_name: books[4].title, summary }] });
		});
		await cover.click();
		const panel = page.getByTestId('book-summary-sheet');
		try {
			// Transport is deliberately blocked: identity and usable actions must already be present.
			await expect(panel.getByRole('heading', { name: books[4].title, exact: true })).toBeVisible();
			await expect(
				panel.getByRole('button', { name: 'Rate 4 out of 5', exact: true })
			).toBeEnabled();
			await expect(
				panel.getByRole('button', { name: 'Remove from Bookmarks', exact: true })
			).toBeEnabled();
			await expect(panel.getByRole('status')).toContainText('Loading book details');
			await expect(panel).not.toContainText('No description available.');
			await expect.poll(() => detailReads).toBe(1);
		} finally {
			release();
		}
		await expect(panel).toContainText(summary ?? 'No description available.');
		await expect(panel.getByRole('status')).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(cover).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(panel).toContainText(summary ?? 'No description available.');
		await expect(panel.getByRole('status')).toHaveCount(0);
		expect(detailReads).toBe(1);
	});
}

test('restored selections reuse already loaded source details without a click-time request', async ({
	page
}) => {
	await setup(page, 10);
	await mockStripCovers(page);
	await page.route('**/api/bookmarks', (route) =>
		route.fulfill({
			json: {
				books: books
					.slice(0, 10)
					.map((book) => ({ ...book, summary: `Already loaded synopsis for ${book.title}.` }))
			}
		})
	);
	await page.goto(`${base}/choose-books?from=bookmarks`);
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await page.reload();
	const cover = page.locator('[data-copy="1"] .cover-hit').nth(2);
	await expect(cover).toBeVisible();
	await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Add all Bookmarks', exact: true })).toBeVisible();
	let detailReads = 0;
	await page.route('**/rest/v1/books?**', async (route) => {
		detailReads++;
		await route.fulfill({ status: 503, json: { message: 'Must not read catalog' } });
	});
	await cover.click();
	const panel = page.getByTestId('book-summary-sheet');
	await expect(panel).toContainText('Already loaded synopsis for Selection Book 4.');
	await expect(panel.getByRole('status')).toHaveCount(0);
	expect(detailReads).toBe(0);
});

async function mockStripCovers(page: Page, varied = false) {
	await page.route('**/*.avif', (route) => {
		const id =
			route
				.request()
				.url()
				.match(/(01\d{24})/u)?.[1] ?? '';
		const index = Number(id.slice(-3));
		const height = varied ? [400, 300, 250][index % 3] : 300;
		return route.fulfill({
			contentType: 'image/svg+xml',
			body: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${height}"><rect width="200" height="${height}" fill="#d6b58d"/><path d="M0 0H200V${height}H0Z" fill="none" stroke="#193c38" stroke-width="12"/><text x="18" y="64" fill="#193c38" font-size="24">Book ${index}</text></svg>`
		});
	});
}

for (const mode of ['rank_selection', 'recommend_from_selection']) {
	for (const source of ['All books', 'Bookmarks', 'Previous recommendations']) {
		test(`candidate cover and title open details independently of selection in ${source} / ${mode}`, async ({
			page
		}) => {
			const state = await setup(page, 10);
			await mockStripCovers(page);
			await page.goto(`${base}/choose-books?mode=${mode}`);
			await expect(page.locator('.selection-tools > span')).toHaveText('0 books selected');
			await page.getByRole('button', { name: source, exact: true }).click();
			if (source === 'All books') await page.getByRole('searchbox').fill('Selection');
			const card = page.locator('.candidate-grid li').first();
			await expect(card).toBeVisible();
			const title = await card.locator('h3').innerText();
			const cover = card.locator('.candidate-cover-hit');
			await cover.click();
			const panel = page.getByTestId('book-summary-sheet');
			await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
			await expect(panel).toContainText(`Complete synopsis for ${title}.`);
			await expect(page.locator('.selection-tools > span')).toHaveText('0 books selected');
			await page.keyboard.press('Escape');
			await expect(cover).toBeFocused();
			await card.locator('.candidate-title-hit').focus();
			await page.keyboard.press('Enter');
			await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(card.locator('.candidate-title-hit')).toBeFocused();
			await card.getByRole('button', { name: `Add ${title}`, exact: true }).click();
			await expect(panel).toHaveCount(0);
			await expect(page.locator('.selection-tools > span')).toHaveText('1 book selected');
			await cover.click();
			await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
			await page.keyboard.press('Escape');
			await card.getByRole('button', { name: `${title} selected`, exact: true }).click();
			await expect(panel).toHaveCount(0);
			await expect(page.locator('.selection-tools > span')).toHaveText('0 books selected');
			expect(state.posts).toHaveLength(0);
			expect(state.writes).toBe(0);
		});
	}
}

test.describe('touch candidate details', () => {
	test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
	test('a single candidate-cover tap opens details without adding the book or moving the page', async ({
		page
	}) => {
		await setup(page, 10);
		await mockStripCovers(page);
		await page.goto(`${base}/choose-books?mode=rank_selection`);
		await page.getByRole('button', { name: 'Bookmarks', exact: true }).tap();
		const cover = page.locator('.candidate-cover-hit').nth(3);
		await cover.scrollIntoViewIfNeeded();
		const scrollY = await page.evaluate(() => window.scrollY);
		await cover.tap();
		const panel = page.getByTestId('book-summary-sheet');
		await expect(panel.getByRole('heading', { name: books[3].title, exact: true })).toBeVisible();
		await expect(page.locator('.selection-tools > span')).toHaveText('0 books selected');
		await panel.getByRole('button', { name: 'Close summary', exact: true }).tap();
		await expect(cover).toBeFocused();
		expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollY, 0);
	});
});

for (const mode of ['rank_selection', 'recommend_from_selection']) {
	test(`hover stacking persists without reordering, and resets across modes, results and refresh in ${mode}`, async ({
		page
	}) => {
		await page.setViewportSize({ width: 1280, height: 1000 });
		const state = await setup(page, 12);
		await mockStripCovers(page);
		await page.goto(`${base}/choose-books?from=bookmarks&mode=${mode}`);
		const strip = page.getByRole('region', { name: 'Selected books', exact: true });
		const covers = strip.locator('[data-copy="1"] .cover-hit');
		await expect(covers).toHaveCount(10);
		const originalOrder = books.slice(2, 12).map((book) => book.book_id);
		await expect
			.poll(() =>
				strip
					.locator('[data-copy="1"] .selected-book')
					.evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.bookId))
			)
			.toEqual(originalOrder);
		const scale = (index: number) =>
			covers.nth(index).evaluate((cover) => {
				const matrix = new DOMMatrixReadOnly(getComputedStyle(cover).transform);
				return Math.hypot(matrix.a, matrix.b);
			});
		await covers.nth(0).hover();
		await expect.poll(() => scale(0)).toBeCloseTo(1.05, 2);
		await covers.nth(1).hover();
		await page.locator('.mode-tabs').hover();
		await expect.poll(() => scale(0)).toBeCloseTo(1, 2);
		await expect.poll(() => scale(1)).toBeCloseTo(1, 2);
		const layers = await covers.evaluateAll((elements) =>
			elements.map((element) => Number(getComputedStyle(element).zIndex))
		);
		expect(layers[1]).toBeGreaterThan(layers[0]);
		expect(layers[0]).toBeGreaterThan(layers[2]);
		expect(
			await strip
				.locator('[data-copy="1"] .selected-book')
				.evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.bookId))
		).toEqual(originalOrder);
		// Keyboard focus is an equivalent promotion, without moving any book in the list.
		await covers.nth(2).focus();
		await expect
			.poll(() => covers.nth(2).evaluate((cover) => Number(getComputedStyle(cover).zIndex)))
			.toBeGreaterThan(layers[1]);
		await page.locator('.mode-tabs button').first().focus();
		const otherMode = mode === 'rank_selection' ? 'Find more like these' : 'Rank my list';
		await page.locator('.mode-tabs').getByRole('button', { name: otherMode, exact: true }).click();
		await page
			.locator('.mode-tabs')
			.getByRole('button', {
				name: mode === 'rank_selection' ? 'Rank my list' : 'Find more like these',
				exact: true
			})
			.click();
		await expect(covers.first()).toHaveCSS('z-index', '0');
		await covers.first().hover();
		state.status = 'completed';
		await page.locator('.selection-action button').click();
		await expect(
			page.getByRole('button', { name: 'Back to selection', exact: true })
		).toBeVisible();
		expect(state.posts[0].book_ids).toEqual(originalOrder);
		await page.getByRole('button', { name: 'Back to selection', exact: true }).click();
		await expect(covers.first()).toHaveCSS('z-index', '0');
		await covers.first().hover();
		await page.locator('.mode-tabs').hover();
		await page.reload();
		await expect(covers.first()).toHaveCSS('z-index', '0');
		expect(state.writes).toBe(0);
	});
}

test('cover clicks open full details, drag gestures never open details, and removal stays independent', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
	const state = await setup(page, 20);
	await mockStripCovers(page);
	await page.goto(`${base}/choose-books?from=bookmarks`);
	const strip = page.getByRole('region', { name: 'Selected books', exact: true });
	const cover = strip.locator('[data-copy="1"] .cover-hit').nth(2);
	await cover.click();
	const panel = page.getByTestId('book-summary-sheet');
	await expect(panel).toContainText('Complete synopsis for Selection Book 4.');
	await expect(
		panel.getByRole('button', { name: 'Remove from Bookmarks', exact: true })
	).toBeEnabled();
	await expect(panel.getByRole('button', { name: 'Not interested', exact: true })).toBeEnabled();
	await expect(panel.getByRole('button', { name: 'Rate 4 out of 5', exact: true })).toBeEnabled();
	const before = await strip.evaluate((element) => element.scrollLeft);
	const layer = await cover.evaluate((element) => getComputedStyle(element).zIndex);
	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
	await expect(cover).toBeFocused();
	await expect(cover).toHaveCSS('z-index', layer);
	expect(Math.abs((await strip.evaluate((element) => element.scrollLeft)) - before)).toBeLessThan(
		1
	);
	await page.keyboard.press('Enter');
	await expect(panel).toContainText('Complete synopsis for Selection Book 4.');
	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
	await strip.hover();
	const bounds = await strip.boundingBox();
	if (!bounds) throw new Error('Strip not visible');
	const start = { x: bounds.x + bounds.width * 0.6, y: bounds.y + bounds.height / 2 };
	await page.mouse.move(start.x, start.y);
	// Test dragging a visible jacket rather than assuming a particular overlapped
	// jacket's center stays exposed after focus restoration and scrolling.
	await expect
		.poll(() =>
			page.evaluate(
				({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.cover-hit')),
				start
			)
		)
		.toBe(true);
	await page.mouse.down();
	await page.mouse.move(start.x - 130, start.y, {
		steps: 12
	});
	await page.mouse.up();
	await expect(panel).toHaveCount(0);
	expect(
		Math.abs((await strip.evaluate((element) => element.scrollLeft)) - before)
	).toBeGreaterThan(100);
	await strip.locator('[data-copy="1"] .remove-book').nth(3).click();
	await expect(page.locator('.selection-tools > span')).toHaveText('17 books selected');
	await expect(panel).toHaveCount(0);
	expect(state.writes).toBe(0);
	// A normal click after a drag must not remain suppressed.
	await strip.locator('[data-copy="1"] .cover-hit').nth(3).click();
	await expect(panel).toBeVisible();
});

test('details retry missing draft metadata and library actions do not edit the selection', async ({
	page
}) => {
	const state = await setup(page, 10);
	await mockStripCovers(page);
	await page.goto(`${base}/choose-books?from=bookmarks`);
	const cover = page.locator('[data-copy="1"] .cover-hit').nth(2);
	await expect(cover).toBeVisible();
	let unavailable = true;
	await page.route('**/rest/v1/books?**', async (route) => {
		if (unavailable) await route.fulfill({ status: 503, json: { message: 'Unavailable' } });
		else await route.fallback();
	});
	await cover.click();
	const panel = page.getByTestId('book-summary-sheet');
	await expect(panel.getByRole('alert')).toContainText(
		'Could not load book details. Please try again.'
	);
	unavailable = false;
	await panel.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(panel).toContainText('Complete synopsis for Selection Book 4.');
	await panel.getByRole('button', { name: 'Rate 4 out of 5', exact: true }).click();
	await expect(
		panel.getByRole('button', { name: 'Rate 4 out of 5 (click again to clear)', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
	await panel.getByRole('button', { name: 'Remove from Bookmarks', exact: true }).click();
	await expect(panel.getByRole('button', { name: 'Add to Bookmarks', exact: true })).toBeVisible();
	await panel.getByRole('button', { name: 'Not interested', exact: true }).click();
	await expect(
		panel.getByRole('button', { name: 'Remove from not interested', exact: true })
	).toBeVisible();
	await expect(page.locator('.selection-tools > span')).toHaveText('8 books selected');
	await page.keyboard.press('Escape');
	await expect(cover).toBeFocused();
	await expect(cover.locator('..')).toHaveClass(/dismissed/);
	expect(state.posts).toHaveLength(0);
});

test.describe('touch cover interactions', () => {
	test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
	test('one tap opens details and a native swipe only scrolls', async ({ page }) => {
		await setup(page, 20);
		await mockStripCovers(page);
		await page.goto(`${base}/choose-books?from=bookmarks`);
		const strip = page.getByRole('region', { name: 'Selected books', exact: true });
		const cover = strip.locator('[data-copy="1"] .cover-hit').first();
		await cover.tap();
		const panel = page.getByTestId('book-summary-sheet');
		await expect(panel).toContainText('Complete synopsis for Selection Book 2.');
		await panel.getByRole('button', { name: 'Close summary', exact: true }).tap();
		await expect(panel).toHaveCount(0);
		await expect
			.poll(() =>
				cover.evaluate((element) => {
					const rect = element.getBoundingClientRect();
					return element.contains(
						document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
					);
				})
			)
			.toBe(true);
		const bounds = await strip.boundingBox();
		if (!bounds) throw new Error('Strip not visible');
		const before = await strip.evaluate((element) => element.scrollLeft);
		const session = await page.context().newCDPSession(page);
		const y = bounds.y + bounds.height / 2;
		await session.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x: 300, y }]
		});
		for (const x of [270, 240, 210, 180, 150, 120])
			await session.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x, y }]
			});
		await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).not.toBe(before);
		await expect(panel).toHaveCount(0);
		await session.detach();
	});
});

for (const viewport of [
	{ width: 1280, height: 1000 },
	{ width: 390, height: 844 }
]) {
	test(`varied cover proportions overlap without letterboxing, edge fades spare controls at ${viewport.width}px`, async ({
		page
	}, info) => {
		await page.setViewportSize(viewport);
		await setup(page, 15);
		await mockStripCovers(page, true);
		await page.goto(`${base}/choose-books?from=bookmarks`);
		const strip = page.getByRole('region', { name: 'Selected books', exact: true });
		await expect(page.locator('.strip-frame')).toHaveClass(/faded/);
		await expect(page).toHaveURL(/\/choose-books\?mode=rank_selection$/);
		await expect
			.poll(() =>
				strip.evaluate(
					(element) => getComputedStyle(element.parentElement!, '::before').backgroundImage
				)
			)
			.toContain('linear-gradient');
		await expect
			.poll(() =>
				strip
					.locator('[data-copy="1"] img')
					.evaluateAll((images) =>
						images.every((image) => (image as HTMLImageElement).naturalWidth > 0)
					)
			)
			.toBe(true);
		const readGeometry = () =>
			strip.evaluate((element) => {
				const frame = element.parentElement!;
				const cards = [...element.querySelectorAll<HTMLElement>('[data-copy="1"] .selected-book')];
				return {
					fade: getComputedStyle(frame, '::before').backgroundImage,
					fadeLayer: Number(getComputedStyle(frame, '::before').zIndex),
					removeLayer: Number(getComputedStyle(cards[0].querySelector('.remove-book')!).zIndex),
					pointerEvents: getComputedStyle(frame, '::before').pointerEvents,
					gaps: cards
						.slice(1)
						.map(
							(card, index) =>
								card.offsetLeft - (cards[index].offsetLeft + cards[index].offsetWidth)
						),
					proportions: cards.map((card) => {
						const image = card.querySelector('img')!;
						return {
							actual: image.clientWidth / image.clientHeight,
							source: image.naturalWidth / image.naturalHeight
						};
					})
				};
			});
		// Route hydration may replace the strip between reads; retry the complete live snapshot.
		await expect.poll(async () => (await readGeometry()).fade).toContain('linear-gradient');
		const geometry = await readGeometry();
		expect(geometry.fade).toContain('linear-gradient');
		expect(geometry.pointerEvents).toBe('none');
		expect(geometry.removeLayer).toBeGreaterThan(geometry.fadeLayer);
		expect(geometry.gaps.every((gap) => gap <= -23)).toBe(true);
		for (const proportion of geometry.proportions)
			expect(proportion.actual).toBeCloseTo(proportion.source, 2);
		await strip.locator('[data-copy="1"] .cover-hit').nth(1).hover();
		await page.screenshot({ path: info.outputPath('overlapping-covers.png'), fullPage: true });
		// Reduced motion preserves promotion while removing the transition.
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await expect(strip.locator('[data-copy="1"] .cover-hit').nth(1)).toHaveCSS(
			'transition-duration',
			'0s'
		);
		await page.getByRole('button', { name: 'Clear entire selection', exact: true }).click();
		await page.getByRole('button', { name: 'Add Selection Book 2', exact: true }).click();
		await expect(page.locator('.strip-frame')).not.toHaveClass(/faded/);
		await expect(strip).not.toHaveClass(/scrollable/);
	});
}
