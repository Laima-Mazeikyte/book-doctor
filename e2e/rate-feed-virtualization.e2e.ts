import { expect, test } from '@playwright/test';
import { base, books, setup, jump } from './rate-feed.fixture';

test.setTimeout(60_000);

test('a long feed preserves interactions and scroll restoration without mounting all its cards', async ({
	page
}) => {
	const state = await setup(page);
	await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('.virtual-feed .book-card').first()).toBeVisible({ timeout: 20_000 });
	expect(await page.locator('.virtual-feed .book-card').count()).toBeLessThan(100);
	await jump(page, 650);
	const card = page.locator(`[data-feed-index="650"] .book-card`);
	await card.locator('.book-card__star').nth(3).click();
	await expect.poll(() => state.writes).toBe(1);
	await jump(page, 0);
	await jump(page, 650);
	await expect(card.locator('.book-card__star').nth(3)).toHaveAttribute('aria-pressed', 'true');
	expect(await page.locator('.virtual-feed .book-card').count()).toBeLessThan(100);
	expect(state.jobs).toBe(0);
	const scroll = await page.evaluate(() => window.scrollY);
	await card
		.getByRole('button', { name: /See summary/ })
		.first()
		.click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(card).toBeInViewport();
	await expect(card.getByRole('button', { name: /See summary/ }).first()).toBeFocused();
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	await page.setViewportSize({ width: 1280, height: 900 });
	await expect(card).toBeInViewport();
	expect(Math.abs((await page.evaluate(() => window.scrollY)) - scroll)).toBeLessThan(500);
	await card
		.getByRole('button', { name: /See summary/ })
		.first()
		.click();
	await page.locator('.book-card__summary-author-pill').click();
	await expect(page.getByRole('button', { name: 'Close search', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Close search', exact: true }).click();
	await expect(card).toBeInViewport();
});

test('only the logical end triggers pagination and a new batch appends without duplicates', async ({
	page
}) => {
	const state = await setup(page);
	await page.goto(`${base}/rate`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('.virtual-feed .book-card').first()).toBeVisible();
	await jump(page, 650);
	await page.waitForTimeout(2100);
	expect(state.jobs).toBe(0);
	await jump(page, 999);
	await expect.poll(() => state.jobs).toBe(1);
	const scroll = await page.evaluate(() => window.scrollY);
	state.release();
	await expect(page.locator('[data-feed-index="1000"]')).toBeAttached();
	await expect(page.locator('[data-feed-index="1000"]')).toHaveAttribute(
		'aria-setsize',
		/1050|1051/
	);
	expect(Math.abs((await page.evaluate(() => window.scrollY)) - scroll)).toBeLessThan(2);
	expect(await page.locator('.virtual-feed .book-card').count()).toBeLessThan(100);
	const ids = await page
		.locator('.virtual-feed .book-card')
		.evaluateAll((cards) => cards.map((card) => card.getAttribute('data-book-id')));
	expect(new Set(ids).size).toBe(ids.length);
	await jump(page, 0);
	await expect(page.locator('[data-feed-index="0"] .book-card')).toHaveAttribute(
		'data-book-id',
		books[0].id
	);
});
