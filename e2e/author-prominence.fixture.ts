import { expect, test as base, type Page } from '@playwright/test';

export const test = base.extend({
	page: async ({ page }, use, testInfo) => {
		const pageErrors: string[] = [];
		const handlePageError = (error: Error) => {
			pageErrors.push(error.stack ?? error.message);
		};
		page.on('pageerror', handlePageError);
		await use(page);
		page.off('pageerror', handlePageError);
		if (pageErrors.length > 0) {
			await testInfo.attach('page-errors', {
				body: pageErrors.join('\n\n'),
				contentType: 'text/plain'
			});
			throw new Error(`The page emitted ${pageErrors.length} error(s):\n${pageErrors.join('\n')}`);
		}
	}
});

export async function openProminence(page: Page): Promise<void> {
	await page.goto('/lab/author-prominence', { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await expect(page.getByTestId('prominence-field')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByTestId('prominence-ranking-panel')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByTestId('prominence-ranking-row').first()).toBeVisible({ timeout: 30_000 });
	await expect(page.getByTestId('prominence-field')).toHaveAttribute('data-pick-ready', 'true', {
		timeout: 5_000
	});
}

export async function selectLeaderFromMap(page: Page): Promise<void> {
	const field = page.getByTestId('prominence-field');
	const overlay = field.locator('.prominence-field__overlay');
	const box = await overlay.boundingBox();
	const x = Number(await field.getAttribute('data-pick-target-x'));
	const y = Number(await field.getAttribute('data-pick-target-y'));
	if (!box || !Number.isFinite(x) || !Number.isFinite(y))
		throw new Error('The field did not expose a pick target.');
	await page.mouse.click(box.x + x, box.y + y);
}

export async function selectAuthorBySearch(page: Page, name: string): Promise<void> {
	const search = page.getByRole('combobox', { name: 'Author search' });
	await search.fill(name);
	const option = page
		.getByRole('option', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
		.first();
	await expect(option).toBeVisible();
	await option.click();
}
