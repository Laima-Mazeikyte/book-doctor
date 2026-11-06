import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from 'vite';

test.setTimeout(90_000);
const base = process.env.STARTING_BOOK_TEST_BASE ?? 'http://127.0.0.1:4173';
const env = loadEnv('development', process.cwd(), '');
const supabaseUrl = env.PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
const authKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const seed = '01KR2ADTFG9DJ85AS30MZFHJG6';
const slug = 'the-hunger-games-suzanne-collins';
const otherSlug = 'agenda-21-glenn-beck';
const userId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const book = {
	id: '00000000-0000-4000-8000-000000000001',
	book_id: seed,
	book_name: 'The Hunger Games',
	title: 'The Hunger Games',
	author: 'Suzanne Collins',
	genre1: 'Fantasy',
	genre2: 'Urban Fantasy',
	keyword1: 'Found Family'
};

test('discovery uses its clean route and crawler policy without preserving the old route', async ({
	request
}) => {
	for (const path of [
		'/discover',
		`/discover?from=${slug}&change=less-violence`,
		'/discover?search=123'
	]) {
		const response = await request.get(base + path);
		expect(response.status()).toBe(200);
		expect(
			(await response.text()).match(/<meta[^>]+name="robots"[^>]*content="noindex"/)
		).toBeNull();
	}
	const robots = await (await request.get(base + '/robots.txt')).text();
	expect(robots).toContain('Disallow: /discover');
	expect(robots).toContain('Sitemap: https://unread.world/sitemap.xml');
	const old = await request.get(base + '/rate/recommendations/filtered');
	expect(old.status()).toBe(404);
	expect(old.headers().location).toBeUndefined();
	const pages = await (await request.get(base + '/sitemap-pages.xml')).text();
	expect(pages).not.toContain('/discover');
});

async function openSeededEditor(page: Page) {
	await page.goto(`${base}/discover?from=${slug}`);
	await expect(page.getByText(book.title, { exact: true })).toBeVisible();
	await expect
		.poll(() => page.locator('.filter-panel').evaluate((node) => getComputedStyle(node).opacity))
		.toBe('1');
}

async function setup(page: Page) {
	await page.route('**/*', (route) =>
		route.request().resourceType() === 'image'
			? route.fulfill({
					contentType: 'image/gif',
					body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
				})
			: route.fallback()
	);
	const session = {
		access_token: 'starting-book-test-token',
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
			app_metadata: { provider: 'email' },
			user_metadata: {},
			created_at: new Date().toISOString()
		}
	};
	await page.addInitScript(
		({ authKey, session }) => localStorage.setItem(authKey, JSON.stringify(session)),
		{ authKey, session }
	);
	const state = {
		bodies: [] as Array<{ user_id: string; filters: Record<string, unknown> }>,
		status: 'processing',
		filters: {} as Record<string, unknown>,
		itemReads: 0,
		resultCount: 2
	};
	await page.route('**/auth/v1/**', (route) => route.fulfill({ json: session }));
	await page.route('**/rest/v1/**', (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const table = url.pathname.split('/').at(-1);
		if (request.method() !== 'GET') {
			if (table === 'recommendation_requests') {
				const body = request.postDataJSON();
				state.bodies.push(body);
				state.filters = body.filters;
				return route.fulfill({ json: { public_id: `SearchA${state.bodies.length}` } });
			}
			return route.fulfill({ status: 204, body: '' });
		}
		if (table === 'books') {
			const fromSlug = url.searchParams.get('slug')?.replace('eq.', '');
			const row =
				fromSlug === otherSlug
					? { ...book, book_id: '01KR2ADTC0FSRR230FSXKVW4VN', slug: otherSlug }
					: { ...book, slug };
			return route.fulfill({ json: fromSlug ? row : [row] });
		}
		if (table === 'recommendation_requests') {
			const row = {
				id: Number(url.searchParams.get('id')?.replace('eq.', '') ?? 55 + state.bodies.length),
				public_id:
					url.searchParams.get('public_id')?.replace('eq.', '') ??
					`SearchA${state.bodies.length || 1}`,
				user_id: userId,
				filters: state.filters,
				status: state.status,
				result_count: state.status === 'completed' ? state.resultCount : null,
				error_code: state.status === 'failed' ? 'invalid_filters' : null,
				created_at: new Date().toISOString()
			};
			return route.fulfill({
				json:
					url.searchParams.has('id') || url.searchParams.has('public_id')
						? row
						: state.bodies.length
							? [row]
							: []
			});
		}
		return route.fulfill({
			json: [],
			headers: { 'content-range': '*/0', 'access-control-expose-headers': 'content-range' }
		});
	});
	await page.route('**/api/**', (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === '/api/recommendations') {
			state.itemReads++;
			return route.fulfill({
				json: {
					request_id: 'SearchA1',
					books: [
						{
							...book,
							id: 'result-1',
							book_id: '01KR2ADTC0FSRR230FSXKVW4VN',
							title: 'First ranked result'
						},
						{
							...book,
							id: 'result-2',
							book_id: '01KR2AP3HG58V40SA7Q2MRTS07',
							title: 'Second ranked result'
						}
					]
				}
			});
		}
		if (url.pathname === '/api/recommendations/count') return route.fulfill({ json: { count: 0 } });
		return route.fulfill({ json: { books: [], rated_count: 0, interaction_count: 0 } });
	});
	return state;
}

test('mobile starting-book search submits once with no ratings, waits for completion, and restores on reload', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = await setup(page);
	await page.goto(`${base}/discover?from=${slug}&change=less-violence`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(page.getByText(book.title, { exact: true })).toBeVisible();
	const submit = page.getByRole('button', { name: 'Find books', exact: true });
	await expect(submit).toBeEnabled();
	expect(state.bodies).toHaveLength(0);
	await submit.click();
	await expect(page).toHaveURL(/search=SearchA1/);
	await expect(page.getByRole('heading', { name: 'Your matches', exact: true })).toBeFocused();
	expect(state.bodies).toEqual([
		{ user_id: userId, filters: { seed_book_id: seed, relative_dimensions: { violence: -0.15 } } }
	]);
	expect(state.itemReads).toBe(0);
	state.status = 'completed';
	await expect(
		page.getByRole('article', { name: 'First ranked result by Suzanne Collins', exact: true })
	).toBeVisible();
	expect(state.itemReads).toBe(1);
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(
		page.getByRole('article', { name: 'First ranked result by Suzanne Collins', exact: true })
	).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.getByRole('button', { name: 'Filters', exact: true }).click();
	await expect(page.getByText(book.title, { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Less violence', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: 'Close filters', exact: true }).click();
	await expect(
		page.getByRole('article', { name: 'First ranked result by Suzanne Collins', exact: true })
	).toBeVisible();
	expect(state.bodies).toHaveLength(1);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await page.screenshot({
		animations: 'disabled',
		path: testInfo.outputPath('starting-book-mobile.png'),
		fullPage: true
	});
});

test('failed seeded search preserves its source and direction for an explicit retry', async ({
	page
}) => {
	const state = await setup(page);
	await page.goto(`${base}/discover?from=${slug}&change=more-action-driven`, {
		waitUntil: 'domcontentloaded'
	});
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect(page).toHaveURL(/search=SearchA1/);
	state.status = 'failed';
	const retry = page.getByRole('button', { name: 'Review filters and try again', exact: true });
	await expect(retry).toBeVisible();
	await expect(page.getByText(/The starting book or filters could not be used/)).toBeVisible();
	expect(state.itemReads).toBe(0);
	await retry.click();
	await page.getByRole('button', { name: 'More introspective', exact: true }).click();
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => state.bodies.length).toBe(2);
	expect(state.bodies[1].filters).toEqual({
		seed_book_id: seed,
		relative_dimensions: { pace: 0.15 }
	});
});

for (const [label, width, height, fontSize] of [
	['mobile', 390, 844, 16],
	['desktop', 1440, 900, 16],
	['below-desktop-breakpoint', 767, 900, 16],
	['desktop-breakpoint', 768, 900, 16],
	['mobile-large-text', 390, 844, 24],
	['small-mobile', 320, 568, 16]
] as const) {
	test(`${label} keeps results first and the filter action visible while preferences scroll`, async ({
		page
	}, testInfo) => {
		await page.setViewportSize({ width, height });
		const state = await setup(page);
		state.status = 'completed';
		state.filters = { seed_book_id: seed, relative_dimensions: { violence: -0.15 } };
		await page.goto(`${base}/discover?search=SearchA1`, {
			waitUntil: 'domcontentloaded'
		});
		await page.evaluate(
			(size) => (document.documentElement.style.fontSize = `${size}px`),
			fontSize
		);
		await page.evaluate(() => document.fonts.ready);
		const result = page.getByRole('article', {
			name: 'First ranked result by Suzanne Collins',
			exact: true
		});
		await expect(result).toBeVisible();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		// A saved run opens on its results, without a long editor in front of them.
		const resultBounds = await result.boundingBox();
		expect(resultBounds!.y).toBeLessThan(height);
		await page.screenshot({
			animations: 'disabled',
			path: testInfo.outputPath(`${label}-results.png`),
			fullPage: true
		});
		await page.getByRole('button', { name: 'Filters', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Refine your search', exact: true });
		await expect(dialog).toBeVisible();
		const panel = page.locator('.filter-panel');
		await expect.poll(async () => Math.round((await panel.boundingBox())?.x ?? -1)).toBe(0);
		await expect.poll(() => panel.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
		const panelBounds = await panel.boundingBox();
		expect(panelBounds!.x).toBeCloseTo(0, 0);
		expect(panelBounds!.y).toBeCloseTo(0, 0);
		expect(panelBounds!.height).toBeCloseTo(height, 0);
		if (width < 768) {
			const dialogBounds = await dialog.boundingBox();
			expect(panelBounds!.width).toBeCloseTo(dialogBounds!.width, 0);
		} else {
			expect(panelBounds!.width).toBeLessThan(width);
		}
		const submit = page.getByRole('button', { name: 'Find books', exact: true });
		await expect(submit).toBeEnabled();
		const before = await submit.boundingBox();
		expect(before!.y).toBeGreaterThanOrEqual(0);
		expect(before!.y + before!.height).toBeLessThanOrEqual(height);
		await page.screenshot({
			animations: 'disabled',
			path: testInfo.outputPath(`${label}-filters.png`)
		});
		await page.getByText('More preferences', { exact: true }).click();
		const pageCount = page.getByRole('group', { name: 'Page count', exact: true });
		await pageCount.getByRole('button', { name: 'Custom range', exact: true }).click();
		await pageCount.getByRole('spinbutton', { name: 'From', exact: true }).fill('100');
		await pageCount.getByRole('spinbutton', { name: 'To', exact: true }).fill('500');
		expect(
			await page
				.locator('.filter-panel__body')
				.evaluate((node) => node.scrollWidth <= node.clientWidth)
		).toBe(true);
		await page.getByText('Book characteristics', { exact: true }).click();
		await page.getByText('More book characteristics', { exact: true }).click();
		await page
			.locator('.filter-panel__body')
			.evaluate((node) => (node.scrollTop = node.scrollHeight));
		const after = await submit.boundingBox();
		expect(after!.y).toBeCloseTo(before!.y, 0);
		expect(after!.y + after!.height).toBeLessThanOrEqual(height);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width
		);
		expect(
			await page.locator('.filter-panel').evaluate((node) => node.scrollWidth <= node.clientWidth)
		).toBe(true);
		await page.screenshot({
			animations: 'disabled',
			path: testInfo.outputPath(`${label}-preferences-scrolled.png`)
		});
		await page.getByText('Genres, themes & tropes', { exact: true }).click();
		await page.getByRole('button', { name: 'Browse all', exact: true }).first().click();
		const tagDialog = page.getByRole('dialog', { name: 'Choose genres', exact: true });
		await expect(tagDialog).toBeVisible();
		const done = page.getByRole('button', { name: 'Done', exact: true });
		const doneBounds = await done.boundingBox();
		expect(doneBounds!.y + doneBounds!.height).toBeLessThanOrEqual(height);
		await expect(done).toBeInViewport();
		await page.screenshot({
			animations: 'disabled',
			path: testInfo.outputPath(`${label}-tag-choices.png`)
		});
		await done.click();
		await expect(tagDialog).toHaveCount(0);
		await page.getByRole('button', { name: 'Close filters', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(result).toBeVisible();
		expect(state.bodies).toHaveLength(0);
	});
}

test('exact tag exclusions and requirements survive reload and an explicit retry', async ({
	page
}, testInfo) => {
	const state = await setup(page);
	await page.goto(`${base}/discover?from=${slug}`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(page.getByText(book.title, { exact: true })).toBeVisible();
	await page.getByText('Genres, themes & tropes', { exact: true }).click();
	await page.getByRole('button', { name: 'Exclude Fantasy', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Exclude Urban Fantasy', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Exclude Found Family', exact: true }).click();
	await page.getByRole('button', { name: 'Browse all', exact: true }).first().click();
	await page.getByRole('searchbox', { name: 'Search genres', exact: true }).fill('Romance');
	await page.getByRole('checkbox', { name: 'Romance', exact: true }).check();
	await page.getByRole('button', { name: 'At least one', exact: true }).click();
	await page.getByRole('searchbox', { name: 'Search genres', exact: true }).fill('Mystery');
	await page.getByRole('checkbox', { name: 'Mystery', exact: true }).check();
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	expect(state.bodies).toHaveLength(0);
	const expected = {
		seed_book_id: seed,
		genres: { all_of: ['Romance'], any_of: ['Mystery'], none_of: ['Fantasy'] },
		keywords: { none_of: ['Found Family'] }
	};
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect(page).toHaveURL(/search=SearchA1/);
	expect(state.bodies[0].filters).toEqual(expected);
	state.status = 'failed';
	await expect(
		page.getByRole('button', { name: 'Review filters and try again', exact: true })
	).toBeVisible();
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'Review filters and try again', exact: true }).click();
	await page.getByText('Genres, themes & tropes', { exact: true }).click();
	await expect(page.getByRole('group', { name: 'Genres: Require all', exact: true })).toContainText(
		'Romance'
	);
	await expect(
		page.getByRole('group', { name: 'Genres: At least one', exact: true })
	).toContainText('Mystery');
	await expect(page.getByRole('group', { name: 'Genres: Exclude', exact: true })).toContainText(
		'Fantasy'
	);
	await page.screenshot({
		animations: 'disabled',
		path: testInfo.outputPath('tag-requirements-desktop.png')
	});
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect(page).toHaveURL(/search=SearchA2/);
	expect(state.bodies).toHaveLength(2);
	expect(state.bodies[1].filters).toEqual(expected);
});

test('mobile empty search broadens only after a click, and source-only emptiness offers another book', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = await setup(page);
	state.resultCount = 0;
	await page.goto(`${base}/discover?from=${slug}&change=less-violence`, {
		waitUntil: 'domcontentloaded'
	});
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect(page).toHaveURL(/search=SearchA1/);
	state.status = 'completed';
	const fallback = page.getByRole('button', { name: 'Use starting book only', exact: true });
	await expect(fallback).toBeVisible();
	expect(state.bodies).toHaveLength(1);
	expect(state.itemReads).toBe(0);
	await page.screenshot({
		animations: 'disabled',
		path: testInfo.outputPath('empty-search-mobile.png')
	});
	await fallback.evaluate((element: HTMLButtonElement) => {
		element.click();
		element.click();
	});
	await expect(page).toHaveURL(/search=SearchA2/);
	expect(state.bodies).toHaveLength(2);
	expect(state.bodies[1].filters).toEqual({ seed_book_id: seed });
	await page.getByRole('button', { name: 'Choose another starting book', exact: true }).click();
	await expect(
		page.getByRole('combobox', { name: 'Starting book (optional)', exact: true })
	).toBeFocused();
	expect(state.bodies).toHaveLength(2);
});

test('tag choices keep their actions reachable on a small screen with enlarged text', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 320, height: 568 });
	await setup(page);
	await page.goto(`${base}/discover?from=${slug}`, {
		waitUntil: 'domcontentloaded'
	});
	await page.evaluate(() => (document.documentElement.style.fontSize = '24px'));
	await page.evaluate(() => document.fonts.ready);
	await page.getByText('Genres, themes & tropes', { exact: true }).click();
	await page.getByRole('button', { name: 'Browse all', exact: true }).first().click();
	const dialog = page.getByRole('dialog', { name: 'Choose genres', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeInViewport({
		ratio: 1
	});
	await expect(page.getByRole('button', { name: 'Close tag choices', exact: true })).toBeInViewport(
		{ ratio: 1 }
	);
	await page.screenshot({
		animations: 'disabled',
		path: testInfo.outputPath('tag-dialog-small-large-text.png')
	});
	const overflow = await page.evaluate(() => ({
		width: document.documentElement.scrollWidth,
		elements: [...document.querySelectorAll('body *')]
			.map((element) => ({
				tag: element.tagName,
				class: element.className,
				text: element.textContent?.slice(0, 45),
				left: element.getBoundingClientRect().left,
				right: element.getBoundingClientRect().right
			}))
			.filter((element) => element.right > innerWidth + 1 || element.left < -1)
			.slice(0, 20)
	}));
	expect(overflow.width, JSON.stringify(overflow.elements)).toBeLessThanOrEqual(320);
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Find books', exact: true })).toBeInViewport({
		ratio: 1
	});
});

test('custom ranges remain editable and incomplete characteristic bounds cannot submit', async ({
	page
}) => {
	const state = await setup(page);
	await openSeededEditor(page);
	await page.getByText('More preferences', { exact: true }).click();
	const pages = page.getByRole('group', { name: 'Page count', exact: true });
	await pages.getByRole('button', { name: 'Custom range', exact: true }).click();
	await pages.getByRole('spinbutton', { name: 'From', exact: true }).fill('100');
	await pages.getByRole('spinbutton', { name: 'From', exact: true }).fill('');
	await expect(pages.getByRole('spinbutton', { name: 'From', exact: true })).toBeFocused();
	await expect(pages.getByRole('spinbutton', { name: 'To', exact: true })).toBeVisible();
	await page.getByText('Book characteristics', { exact: true }).click();
	const violence = page.getByRole('group', { name: 'Violence', exact: true }).last();
	await violence.getByRole('button', { name: 'Custom', exact: true }).click();
	const maximum = violence.getByRole('spinbutton', { name: 'To', exact: true });
	await maximum.fill('');
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect(maximum).toBeFocused();
	expect(state.bodies).toHaveLength(0);
	await expect(maximum).toHaveValue('');
	await maximum.fill('0.4');
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => state.bodies.length).toBe(1);
	expect(state.bodies[0].filters).toEqual({
		seed_book_id: seed,
		dimensions: { violence: { min: 0, max: 0.4 } }
	});
});

test('missing slug sources stay unsubmitted and failed lookups offer retry', async ({ page }) => {
	const state = await setup(page);
	let mode: 'missing' | 'error' | 'ready' = 'missing';
	await page.route('**/rest/v1/books?**', (route) =>
		mode === 'error'
			? route.fulfill({ status: 503, json: { message: 'Fixture catalog unavailable' } })
			: route.fulfill({ json: mode === 'missing' ? [] : [book] })
	);
	await page.goto(`${base}/discover?from=${slug}`);
	await expect(page.locator('.filtered-page__form-error')).toContainText(
		'This starting book is unavailable.'
	);
	await expect(page.getByRole('button', { name: 'Find books', exact: true })).toBeDisabled();
	expect(state.bodies).toHaveLength(0);
	mode = 'ready';
	await page.route('**/functions/v1/book-search', (route) =>
		route.fulfill({ json: { hits: [{ book_id: seed }], estimatedTotalHits: 1 } })
	);
	await page
		.getByRole('combobox', { name: 'Starting book (optional)', exact: true })
		.fill('Hunger');
	await page.getByRole('option', { name: 'The Hunger Games Suzanne Collins', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Find books', exact: true })).toBeEnabled();
	mode = 'error';
	await page.reload();
	await expect(
		page.getByText('Could not load the starting book. Try again or choose another.', {
			exact: true
		})
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Find books', exact: true })).toBeDisabled();
	mode = 'ready';
	await page.getByRole('button', { name: 'Try again', exact: true }).click();
	await expect(page.getByText(book.title, { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => state.bodies.length).toBe(1);
});

test('book and author comboboxes select the active option and Escape dismisses suggestions first', async ({
	page
}) => {
	const state = await setup(page);
	const second = { ...book, book_id: '01KR2ADTC0FSRR230FSXKVW4VN', book_name: 'Hunger Two' };
	await page.route('**/functions/v1/book-search', (route) =>
		route.fulfill({
			json: { hits: [{ book_id: seed }, { book_id: second.book_id }], estimatedTotalHits: 2 }
		})
	);
	await page.route('**/rest/v1/books?**', (route) =>
		route.fulfill({
			json: new URL(route.request().url()).searchParams.has('slug') ? book : [book, second]
		})
	);
	await page.route('**/recommendation-authors.json', (route) =>
		route.fulfill({
			json: [
				['Author One', 10],
				['Author Two', 5]
			]
		})
	);
	await openSeededEditor(page);
	await page.getByRole('button', { name: 'Remove', exact: true }).click();
	const input = page.getByRole('combobox', { name: 'Starting book (optional)', exact: true });
	await input.fill('Hun');
	await expect(
		page.getByRole('option', { name: 'Hunger Two Suzanne Collins', exact: true })
	).toBeVisible();
	await input.press('Escape');
	await expect(page.getByRole('listbox', { name: 'Starting book suggestions' })).toHaveCount(0);
	await expect(page.getByRole('dialog', { name: 'Refine your search' })).toBeVisible();
	await input.press('ArrowDown');
	await input.press('ArrowDown');
	await expect(
		page.getByRole('option', { name: 'Hunger Two Suzanne Collins', exact: true })
	).toHaveAttribute('aria-selected', 'true');
	await input.press('Enter');
	await expect(page.getByText('Hunger Two', { exact: true })).toBeVisible();
	await page.getByText('More preferences', { exact: true }).click();
	const authors = page.getByRole('combobox', { name: 'Authors', exact: true });
	await authors.fill('Author');
	await expect(page.getByRole('option', { name: 'Author Two', exact: true })).toBeVisible();
	await authors.press('Escape');
	await expect(page.getByRole('listbox', { name: 'Authors suggestions' })).toHaveCount(0);
	await expect(page.getByRole('dialog', { name: 'Refine your search' })).toBeVisible();
	await authors.press('ArrowDown');
	await authors.press('ArrowDown');
	await authors.press('Enter');
	await expect(page.getByRole('button', { name: 'Remove Author Two', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => state.bodies.length).toBe(1);
	expect(state.bodies[0].filters).toEqual({
		seed_book_id: second.book_id,
		authors: ['Author Two']
	});
});

test('Back and Forward manage drawer and tag layers, retain drafts, and leave no layer after submission', async ({
	page
}) => {
	const state = await setup(page);
	state.status = 'completed';
	state.filters = { seed_book_id: seed };
	await page.goto(`${base}/rate/recommendations`);
	await page.goto(`${base}/discover?search=55`);
	await expect(page.locator('.filtered-page__grid')).toBeVisible();
	await page.getByRole('button', { name: 'Filters', exact: true }).click();
	await page.getByRole('button', { name: 'More violence', exact: true }).click();
	await page.goBack();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page).toHaveURL(/discover\?search=55$/);
	await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeFocused();
	await page.goForward();
	await expect(page.getByRole('button', { name: 'More violence', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByText('Genres, themes & tropes', { exact: true }).click();
	await page.getByRole('button', { name: 'Browse all', exact: true }).first().click();
	await expect(page.getByRole('dialog', { name: 'Choose genres', exact: true })).toBeVisible();
	await page.goBack();
	await expect(page.getByRole('dialog', { name: 'Choose genres', exact: true })).toHaveCount(0);
	await expect(page.getByRole('dialog', { name: 'Refine your search', exact: true })).toBeVisible();
	await page.goForward();
	await expect(page.getByRole('dialog', { name: 'Choose genres', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Choose genres', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect(page).toHaveURL(/search=SearchA1$/);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.goBack();
	await expect(page).toHaveURL(/search=55$/);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	expect(state.bodies).toHaveLength(1);
});

test('uncertain submissions refresh committed history and offer recovery without another write', async ({
	page
}) => {
	const state = await setup(page);
	await page.route('**/rest/v1/recommendation_requests?**', (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		const body = route.request().postDataJSON();
		state.bodies.push(body);
		state.filters = body.filters;
		// Commit the fixture row, but lose the write acknowledgement.
	});
	await openSeededEditor(page);
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect(page.getByRole('button', { name: 'View recent searches', exact: true })).toBeVisible(
		{ timeout: 22000 }
	);
	await page.getByRole('button', { name: 'View recent searches', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Recent searches', exact: true })).toBeFocused();
	const run = page
		.locator('.filtered-page__recent')
		.getByRole('link', { name: /Starting from The Hunger Games/ });
	await expect(run).toHaveAttribute('href', '/discover?search=SearchA1');
	await page.getByRole('button', { name: 'Filters', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Find books', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: 'Close filters', exact: true }).click();
	state.status = 'completed';
	await run.click();
	await expect(page.locator('.filtered-page__grid')).toBeVisible();
	expect(state.bodies).toHaveLength(1);
});

test('Back from a submitted new search preserves the closed base entry and Forward run', async ({
	page
}) => {
	const state = await setup(page);
	state.status = 'completed';
	await openSeededEditor(page);
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect(page).toHaveURL(/search=SearchA1$/);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`from=${slug}$`));
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.goForward();
	await expect(page).toHaveURL(/search=SearchA1$/);
	await expect(page.locator('.filtered-page__grid')).toBeVisible();
	expect(state.bodies).toHaveLength(1);
});

test('changing a source URL with its drawer open replaces the editor safely', async ({ page }) => {
	const state = await setup(page);
	const other = '01KR2ADTC0FSRR230FSXKVW4VN';
	await openSeededEditor(page);
	// Use client navigation as an in-app starting-book link would.
	await page.evaluate((path) => {
		const link = document.createElement('a');
		link.href = path;
		link.textContent = 'Change source fixture';
		document.querySelector('.filter-panel')!.append(link);
		link.click();
	}, `/discover?from=${otherSlug}`);
	await expect(page).toHaveURL(new RegExp(`from=${otherSlug}$`));
	await expect(page.getByRole('dialog', { name: 'Refine your search' })).toHaveCount(1);
	await expect(page.getByRole('dialog', { name: 'Refine your search' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Find books', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'Find books', exact: true }).click();
	await expect.poll(() => state.bodies.length).toBe(1);
	expect(state.bodies[0].filters.seed_book_id).toBe(other);
});

test('saved results show library errors and Retry without opening filters', async ({ page }) => {
	const state = await setup(page);
	state.status = 'completed';
	state.filters = { seed_book_id: seed };
	let failed = true;
	await page.route('**/rest/v1/user_bookmarks?**', (route) =>
		failed
			? route.fulfill({ status: 403, json: { message: 'Fixture library unavailable' } })
			: route.fallback()
	);
	await page.goto(`${base}/discover?search=SearchA1`);
	await expect(page.locator('.filtered-page__grid')).toBeVisible();
	await expect(page.getByTestId('library-load-notice')).toBeVisible();
	failed = false;
	await page.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(page.getByTestId('library-load-notice')).toHaveCount(0);
	await page.getByRole('button', { name: 'Filters', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Find books', exact: true })).toBeEnabled();
});

test('result grids share desktop gutters and secondary picker controls meet the touch target', async ({
	page
}, info) => {
	const state = await setup(page);
	state.status = 'completed';
	state.filters = { seed_book_id: seed };
	await page.route('**/api/recommendations/unique', (route) =>
		route.fulfill({ json: { books: [book], hasRuns: true } })
	);
	for (const width of [1440, 1920]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${base}/rate/recommendations`);
		await expect(page.locator('.recommendations-page__unique-grid')).toBeVisible();
		const forYou = await page.locator('.recommendations-page__unique-grid').boundingBox();
		await page.goto(`${base}/discover?search=SearchA1`);
		await expect(page.locator('.filtered-page__grid')).toBeVisible();
		const filtered = await page.locator('.filtered-page__grid').boundingBox();
		expect(filtered!.x).toBeCloseTo(forYou!.x, 0);
		expect(filtered!.width).toBeCloseTo(forYou!.width, 0);
	}
	await page.getByRole('button', { name: 'Filters', exact: true }).click();
	await page.getByText('Genres, themes & tropes', { exact: true }).click();
	for (const action of [
		page.getByRole('button', { name: 'Remove', exact: true }),
		page.getByRole('button', { name: 'Browse all', exact: true }).first()
	])
		expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({
		path: info.outputPath('aligned-mobile-filters.png'),
		animations: 'disabled'
	});
	await page.getByRole('button', { name: 'Close filters', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.screenshot({
		path: info.outputPath('aligned-mobile-results.png'),
		animations: 'disabled',
		fullPage: true
	});
});
