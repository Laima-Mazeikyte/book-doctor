import { expect } from '@playwright/test';
import { openProminence, selectAuthorBySearch, test } from './author-prominence.fixture';

type CatalogMode = 'success' | 'fail-first';

function catalogRow(bookUlid: string) {
	return {
		id: 'uuid-author-sheet-book',
		book_id: bookUlid,
		book_name: 'Catalog result',
		author: 'A.A. Milne',
		summary: 'A complete catalog summary.',
		year: 1926,
		genre1: 'Children & Young Adult',
		genre2: 'Fantasy',
		genre3: null,
		genre4: null,
		genre5: null,
		genre6: null,
		genre7: null,
		type: 'novel'
	};
}

async function interceptCatalog(
	page: import('@playwright/test').Page,
	mode: CatalogMode = 'success'
): Promise<{ requests: () => number }> {
	let requestCount = 0;
	await page.route('**/rest/v1/books*', async (route) => {
		requestCount += 1;
		if (mode === 'fail-first' && requestCount === 1) {
			await route.fulfill({ status: 503, body: 'catalog unavailable' });
			return;
		}
		const match = decodeURIComponent(route.request().url()).match(/01[0-9A-HJKMNP-TV-Z]{24}/i);
		const bookUlid = match?.[0].toUpperCase() ?? '01KR2ADTNG29NSQV23VAGV8FXB';
		await route.fulfill({ json: [catalogRow(bookUlid)] });
	});
	return { requests: () => requestCount };
}

async function openAuthorInspector(page: import('@playwright/test').Page): Promise<void> {
	await openProminence(page);
	await selectAuthorBySearch(page, 'A.A. Milne');
	await expect(page.getByTestId('prominence-covers')).toBeVisible({ timeout: 10_000 });
}

async function openDeepLinkedAuthorInspector(page: import('@playwright/test').Page): Promise<void> {
	await openProminence(page);
	await page.goto('/lab/author-prominence?lens=Balanced&author=v3%3AA.A.%20Milne', {
		waitUntil: 'domcontentloaded',
		timeout: 60_000
	});
	await expect(page.getByTestId('prominence-field')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByTestId('prominence-field')).toHaveAttribute('data-pick-ready', 'true', {
		timeout: 5_000
	});
	await expect(page.getByTestId('prominence-covers')).toBeVisible({ timeout: 10_000 });
}

test.describe('author prominence book summary sheet', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('loads complete catalog details only after cover activation and reuses the page cache', async ({
		page
	}) => {
		const catalog = await interceptCatalog(page);
		await openAuthorInspector(page);
		const cover = page.locator('.prominence-cover__button').first();
		await expect(cover).toBeVisible();
		await expect.poll(() => new URL(page.url()).searchParams.get('author')).toBe('v3:A.A. Milne');
		const authorUrl = page.url();
		expect(catalog.requests()).toBe(0);

		await cover.click();
		const sheet = page.getByTestId('book-summary-sheet');
		await expect(sheet).toBeVisible();
		await expect(sheet.getByRole('heading', { name: 'Catalog result' })).toBeVisible();
		expect(catalog.requests()).toBe(1);
		await sheet.getByRole('button', { name: 'Close summary' }).dispatchEvent('click');
		await expect(sheet).toBeHidden();
		await expect(cover).toBeFocused();

		await cover.click();
		await expect(sheet.getByRole('heading', { name: 'Catalog result' })).toBeVisible();
		expect(catalog.requests()).toBe(1);
		expect(page.url()).toBe(authorUrl);
		await sheet.getByRole('button', { name: 'Close summary' }).dispatchEvent('click');
		await expect(sheet).toBeHidden();
		await expect(cover).toBeFocused();
		await page.goBack();
		await expect(page).not.toHaveURL(authorUrl);
	});

	test('browser Back closes the sheet before changing author or lens state', async ({ page }) => {
		await interceptCatalog(page);
		await openAuthorInspector(page);
		await page.locator('.prominence-cover__button').first().click();
		const sheet = page.getByTestId('book-summary-sheet');
		await expect(sheet).toBeVisible();
		const authorUrl = page.url();

		await page.goBack();
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(authorUrl);
		await expect(page.getByTestId('prominence-inspector')).toBeVisible();
		await expect(page.locator('#inspector-heading')).toHaveText('A.A. Milne');
	});

	test('navigation away strips the sheet marker before returning to author prominence', async ({
		page
	}) => {
		await interceptCatalog(page);
		await openDeepLinkedAuthorInspector(page);
		const cover = page.locator('.prominence-cover__button').first();
		await cover.click();
		await expect(page.getByTestId('book-summary-sheet')).toBeVisible();
		const authorUrl = page.url();

		await page.getByRole('link', { name: 'Lab', exact: true }).last().dispatchEvent('click');
		await expect(page).toHaveURL(/\/lab$/);
		await expect(page.getByRole('heading', { name: 'Lab', exact: true })).toBeVisible();
		await page.goBack();
		await expect(page).toHaveURL(authorUrl);
		await expect(page.getByTestId('book-summary-sheet')).toBeHidden();
		await expect(page.getByTestId('prominence-inspector')).toBeVisible();
		expect(await page.evaluate(() => window.history.state?.bookSummarySheet)).toBeUndefined();

		await page.goBack();
		await expect(page).not.toHaveURL(authorUrl);
	});

	test('shows a retryable catalog error and evicts the failed request', async ({ page }) => {
		const catalog = await interceptCatalog(page, 'fail-first');
		await openAuthorInspector(page);
		await page.locator('.prominence-cover__button').first().click();
		const sheet = page.getByTestId('book-summary-sheet');
		const alert = sheet.getByRole('alert');
		await expect(alert).toContainText('Book details unavailable. Please try again.');
		await expect(alert).not.toContainText('catalog unavailable');
		await expect(sheet.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();

		await sheet.getByRole('button', { name: 'Retry', exact: true }).click();
		await expect(sheet.getByRole('heading', { name: 'Catalog result' })).toBeVisible();
		expect(catalog.requests()).toBe(2);
	});

	test('author-pill search suppresses sheet focus restoration and focuses the search combobox', async ({
		page
	}) => {
		await interceptCatalog(page);
		await openAuthorInspector(page);
		const cover = page.locator('.prominence-cover__button').first();
		await cover.click();
		const sheet = page.getByTestId('book-summary-sheet');
		await expect(sheet.getByRole('heading', { name: 'Catalog result' })).toBeVisible();

		await sheet.getByRole('button', { name: 'Search for books by A.A. Milne' }).click();
		await expect(sheet).toBeHidden();
		const search = page.getByRole('combobox', { name: 'Author search' });
		await expect(search).toHaveValue('A.A. Milne');
		await expect(search).toBeFocused();

		await search.fill('Stephen King');
		await expect(search).toBeFocused();
	});
});

test.describe('author prominence book summary sheet mobile dismissal', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('supports Escape and drag-to-dismiss without losing the inspector', async ({ page }) => {
		await interceptCatalog(page);
		await openAuthorInspector(page);
		const cover = page.locator('.prominence-cover__button').first();
		await cover.click();
		const sheet = page.getByTestId('book-summary-sheet');
		await expect(sheet.getByRole('heading', { name: 'Catalog result' })).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
		await expect(cover).toBeFocused();

		await cover.click();
		await expect(sheet.getByRole('heading', { name: 'Catalog result' })).toBeVisible();
		const content = sheet.locator('.book-card__summary-content');
		await expect
			.poll(async () => (await content.boundingBox())?.y ?? Number.POSITIVE_INFINITY)
			.toBeLessThan(2);
		const box = await content.boundingBox();
		expect(box).not.toBeNull();
		if (!box) throw new Error('The summary content has no layout box.');
		await page.mouse.move(box.x + box.width / 2, box.y + 100);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y + 260);
		await page.mouse.up();
		await expect(sheet).toBeHidden();
		await expect(page.getByTestId('prominence-inspector')).toBeVisible();
	});
});
