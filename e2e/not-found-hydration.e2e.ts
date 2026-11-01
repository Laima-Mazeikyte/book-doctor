import { expect, test } from '@playwright/test';
import { NOT_FOUND_QUOTES } from '../src/lib/copy/notFoundQuotes';

test.setTimeout(60_000);
const base = 'http://127.0.0.1:4173';

declare global {
	interface Window {
		notFoundQuoteTrace: string[];
		stopNotFoundObserver: () => void;
	}
}

for (const pathname of ['/missing-page-for-hydration-regression', '/books/not_a_book']) {
	test(`404 quote and header remain stable through hydration: ${pathname}`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		// These pages need no auth or catalog writes. Keep the browser check isolated.
		await page.route('**/auth/v1/**', (route) => route.abort());

		let releaseScripts!: () => void;
		const scriptsReady = new Promise<void>((resolve) => (releaseScripts = resolve));
		let holdScripts = true;
		await page.route('**/*', async (route) => {
			if (holdScripts && route.request().resourceType() === 'script') await scriptsReady;
			await route.fallback();
		});

		try {
			const response = await page.goto(`${base}${pathname}`, { waitUntil: 'commit' });
			expect(response?.status()).toBe(404);
			await page.locator('h1').waitFor({ state: 'attached' });
			await page.evaluate(() => document.fonts.ready);
			const before = await page.evaluate(() => ({
				quote: document.querySelector('h1')!.textContent!.trim(),
				headerHeight: document.querySelector('header')!.getBoundingClientRect().height
			}));
			expect(NOT_FOUND_QUOTES.map((quote) => quote.replaceAll('*', ''))).toContain(before.quote);

			// Force a different browser-side random result: the old onMount reroll must fail.
			const initialIndex = NOT_FOUND_QUOTES.findIndex(
				(quote) => quote.replaceAll('*', '') === before.quote
			);
			await page.evaluate(
				({ index, count }) => {
					Math.random = () => (((index + 1) % count) + 0.5) / count;
					window.notFoundQuoteTrace = [];
					const record = () => {
						const quote = document.querySelector('h1')?.textContent?.trim();
						if (quote && window.notFoundQuoteTrace.at(-1) !== quote) {
							window.notFoundQuoteTrace.push(quote);
						}
					};
					const observer = new MutationObserver(record);
					observer.observe(document.documentElement, {
						subtree: true,
						childList: true,
						characterData: true,
						attributes: true
					});
					window.stopNotFoundObserver = () => observer.disconnect();
					record();
				},
				{ index: initialIndex, count: NOT_FOUND_QUOTES.length }
			);

			holdScripts = false;
			releaseScripts();
			await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
			await page.evaluate(() => document.fonts.ready);
			const after = await page.evaluate(() => {
				window.stopNotFoundObserver();
				return {
					quotes: window.notFoundQuoteTrace,
					headerHeight: document.querySelector('header')!.getBoundingClientRect().height
				};
			});
			expect(after.quotes).toEqual([before.quote]);
			expect(after.headerHeight).toBeCloseTo(before.headerHeight, 1);
			await expect(page.getByText('404 / Page not found', { exact: true })).toBeVisible();
			expect(errors).toEqual([]);
		} finally {
			holdScripts = false;
			releaseScripts();
		}
	});
}
