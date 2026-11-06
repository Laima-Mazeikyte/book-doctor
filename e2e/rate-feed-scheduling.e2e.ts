import { expect, test, type Page } from '@playwright/test';
import { base, books, setup, jump } from './rate-feed.fixture';

test.setTimeout(60_000);
const loadMore = (page: Page) =>
	page.getByRole('button', { name: 'Load more books into the list', exact: true });
async function openFeed(page: Page) {
	await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('.virtual-feed .book-card').first()).toBeVisible({ timeout: 20_000 });
}

for (const [layout, viewport] of [
	['desktop', { width: 1280, height: 900 }],
	['mobile', { width: 390, height: 844 }]
] as const) {
	test(`prefetches before the end on ${layout} and waits for entry into the new books`, async ({
		page
	}) => {
		await page.setViewportSize(viewport);
		const state = await setup(page, { initialCount: 50 });
		await openFeed(page);
		await jump(page, layout === 'mobile' ? 36 : 25);
		await expect.poll(() => state.jobs).toBe(1);
		await expect(page.locator('[data-feed-index="49"]')).not.toBeInViewport();
		await expect(page.getByText('Finding your next books…', { exact: true })).toBeVisible();
		const scroll = await page.evaluate(() => window.scrollY);
		await page.waitForTimeout(2100);
		expect(state.jobs).toBe(1);
		state.release();
		await expect(page.locator('[data-feed-index="99"]')).toBeAttached();
		expect(Math.abs((await page.evaluate(() => window.scrollY)) - scroll)).toBeLessThan(2);
		await page.waitForTimeout(2100);
		expect(state.jobs).toBe(1);
	});
}

test('100 encountered books require only Load more; each click allows one batch and feedback resumes auto loading', async ({
	page
}) => {
	const state = await setup(page);
	await openFeed(page);
	// Small overlapping jumps expose real cards; overscan and skipped rows must not count.
	for (let index = 0; index <= 120; index += 8) await jump(page, index);
	await jump(page, 999);
	await expect(loadMore(page)).toHaveText('Load more');
	await page.waitForTimeout(2200);
	expect(state.jobs).toBe(0);
	await loadMore(page).click();
	await expect.poll(() => state.jobs).toBe(1);
	state.release();
	await expect(page.locator('.virtual-feed [data-feed-book]').first()).toHaveAttribute(
		'aria-setsize',
		'1051'
	);
	await jump(page, 1049);
	await page.waitForTimeout(2200);
	expect(state.jobs).toBe(1);
	await loadMore(page).click();
	await expect.poll(() => state.jobs).toBe(2);
	await expect(page.locator('.virtual-feed [data-feed-book]').first()).toHaveAttribute(
		'aria-setsize',
		'1101'
	);
	await jump(page, 1099);
	await page.waitForTimeout(2200);
	expect(state.jobs).toBe(2);
	// The layout retains the checkpoint through an ordinary navigation away and back.
	await page.getByRole('link', { name: 'Unread, home', exact: true }).first().click();
	await page.getByRole('link', { name: 'Start rating', exact: true }).click();
	await expect(page.locator('.virtual-feed .book-card').first()).toBeVisible();
	const restoredCount =
		Number(
			await page.locator('.virtual-feed [data-feed-book]').first().getAttribute('aria-setsize')
		) - 1;
	await jump(page, restoredCount - 1);
	await page.waitForTimeout(2200);
	expect(state.jobs).toBe(2);
	await page
		.locator(`[data-feed-index="${restoredCount - 1}"] .book-card__star`)
		.nth(3)
		.click();
	await expect.poll(() => state.jobs).toBe(3);
	await expect(page.locator('.virtual-feed [data-feed-book]').first()).toHaveAttribute(
		'aria-setsize',
		String(restoredCount + 50)
	);
});

test('feedback during generation excludes returned books and search does not create another job', async ({
	page
}) => {
	const state = await setup(page, { initialCount: 50 });
	state.searchBooks = books.slice(50, 53);
	state.returnedBooks = [books[0], ...books.slice(50, 100), books[50]];
	await openFeed(page);
	await jump(page, 25);
	await expect.poll(() => state.jobs).toBe(1);
	await page.locator('.search-bar__trigger').click();
	await page.locator('.rate-search-overlay input').fill('Virtual');
	await expect(page.locator('.rate-search-overlay .book-card')).toHaveCount(3);
	const card = (index: number) =>
		page.locator(`.rate-search-overlay .book-card[data-book-id="${books[index].id}"]`);
	await card(50).locator('.book-card__star').nth(3).click();
	await card(51).locator('.book-card__cover-actions--tl button').click();
	await card(52).locator('.book-card__cover-actions--br button').click();
	await expect.poll(() => state.writes).toBe(3);
	await page.waitForTimeout(2200);
	expect(state.jobs).toBe(1);
	state.release();
	await expect(page.locator('.virtual-feed .book-card')).toHaveCount(97);
	for (const index of [50, 51, 52])
		await expect(
			page.locator(`.virtual-feed .book-card[data-book-id="${books[index].id}"]`)
		).toHaveCount(0);
	await page.getByRole('button', { name: 'Close search', exact: true }).click();
	expect(state.jobs).toBe(1);
});

test('a failed request keeps existing books and waits for an explicit retry', async ({ page }) => {
	const state = await setup(page, { initialCount: 50 });
	state.status = 'failed';
	await openFeed(page);
	await jump(page, 25);
	await expect.poll(() => state.jobs).toBe(1);
	state.release();
	await expect(page.locator('.error-banner')).toBeVisible();
	await expect(page.locator('.virtual-feed .book-card')).toHaveCount(50);
	await page.waitForTimeout(2200);
	expect(state.jobs).toBe(1);
	state.status = 'completed';
	await loadMore(page).click();
	await expect.poll(() => state.jobs).toBe(2);
	await expect(page.locator('.virtual-feed .book-card')).toHaveCount(100);
});
