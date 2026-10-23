import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from 'vite';

test.setTimeout(90_000);
const base = 'http://127.0.0.1:4173';
const env = loadEnv('development', process.cwd(), '');
const authKey = `sb-${new URL(env.PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

async function setup(page: Page) {
	const userId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
	const session = {
		access_token: 'modal-test-token',
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
		({ authKey, session }) => localStorage.setItem(authKey, JSON.stringify(session)),
		{ authKey, session }
	);
	const state = { done: false, jobs: 0 };
	await page.route('**/auth/v1/**', (route) => route.fulfill({ json: session }));
	await page.route('**/rest/v1/**', (route) => {
		const table = new URL(route.request().url()).pathname.split('/').at(-1);
		if (table === 'goodreads_import_jobs') {
			if (route.request().method() === 'POST') {
				state.jobs++;
				return route.fulfill({ json: { id: 'job-1' } });
			}
			return route.fulfill({
				json: {
					status: state.done ? 'done' : 'pending',
					matched_count: state.done ? 1 : 0,
					unmatched: [],
					error: null
				}
			});
		}
		return route.fulfill({ json: [] });
	});
	await page.route('**/api/**', (route) => route.fulfill({ json: { books: [], count: 0 } }));
	await page.goto(`${base}/faq`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('.app-header__account-trigger')).toBeAttached({ timeout: 45_000 });
	return state;
}

test('feedback contains keyboard focus, closes from the textarea, and returns to its footer opener', async ({
	page
}, testInfo) => {
	await setup(page);
	const opener = page.locator('footer').getByRole('button', { name: 'Give feedback', exact: true });
	await opener.click();
	const dialog = page.getByRole('dialog', { name: 'Give feedback or report a bug', exact: true });
	const input = dialog.getByRole('textbox', { name: 'Message or question', exact: true });
	await expect(input).toBeFocused();
	const close = dialog.getByRole('button', { name: 'Close', exact: true });
	await close.focus();
	await page.keyboard.press('Shift+Tab');
	await expect(dialog.getByRole('button', { name: 'Send feedback', exact: true })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(close).toBeFocused();
	await opener.evaluate((element: HTMLElement) => element.focus());
	await expect(close).toBeFocused();
	await page.screenshot({ path: testInfo.outputPath('feedback-dialog.png') });
	await input.focus();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(opener).toBeFocused();
	await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});

test('mobile feedback restores focus to Menu after its menu item is removed', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await setup(page);
	const menu = page.locator('.app-header__menu-toggle');
	await menu.click();
	await page
		.locator('#app-header-mobile-menu')
		.getByRole('button', { name: 'Report a bug or send feedback', exact: true })
		.click();
	const dialog = page.getByRole('dialog', { name: 'Give feedback or report a bug', exact: true });
	await expect(
		dialog.getByRole('textbox', { name: 'Message or question', exact: true })
	).toBeFocused();
	await expect(page.locator('#app-header-mobile-menu')).toHaveCount(0);
	await expect(dialog).toHaveCSS('opacity', '1');
	await page.screenshot({ path: testInfo.outputPath('mobile-feedback-dialog.png') });
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(menu).toBeFocused();
});

test('an active import keeps focus and resists closing, then stays modal across navigation and restores Account', async ({
	page
}, testInfo) => {
	const state = await setup(page);
	const account = page.locator('.app-header__account-trigger');
	await account.click();
	await page.getByRole('menuitem', { name: 'Sync library', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Library sync', exact: true });
	const close = dialog.getByRole('button', { name: 'Close', exact: true });
	await expect(close).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(dialog.locator('input[type="file"]')).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(close).toBeFocused();
	await dialog.locator('input[type="file"]').setInputFiles({
		name: 'ratings.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from('Title,Author,Rating\nA book,An author,4')
	});
	await dialog.getByRole('button', { name: 'Import ratings', exact: true }).click();
	await expect(close).toBeDisabled();
	await expect.poll(() => state.jobs).toBe(1);
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.press('Escape');
	await dialog.click({ position: { x: 4, y: 4 } });
	await expect(dialog).toBeVisible();
	expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
	state.done = true;
	await expect(page).toHaveURL(/\/my-bookshelf(?:\?|$)/, { timeout: 20_000 });
	await expect(dialog.getByRole('status')).toContainText('1 rating imported.');
	await expect(close).toBeEnabled();
	expect(
		await dialog.evaluate((node) => node.matches(':modal') && node.contains(document.activeElement))
	).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('import-complete-dialog.png') });
	await close.click();
	await expect(dialog).toHaveCount(0);
	await expect(account).toBeFocused();
	expect(state.jobs).toBe(1);
});

test('mobile import closes by backdrop and restores Menu', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await setup(page);
	const menu = page.locator('.app-header__menu-toggle');
	await menu.click();
	await page
		.locator('#app-header-mobile-menu')
		.getByRole('button', { name: 'Sync library', exact: true })
		.click();
	const dialog = page.getByRole('dialog', { name: 'Library sync', exact: true });
	await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
	await dialog.click({ position: { x: 4, y: 4 } });
	await expect(dialog).toHaveCount(0);
	await expect(menu).toBeFocused();
});
