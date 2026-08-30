import { expect } from '@playwright/test';
import { openProminence, test } from './author-prominence.fixture';

const FRAME_BUDGET_MS = 40;

function percentile(values: number[], fraction: number): number {
	const sorted = values.slice().sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

test.describe('author prominence performance smoke', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('repeated lens updates stay within a tolerant user-timing percentile budget', async ({
		page
	}) => {
		await openProminence(page);
		const field = page.getByTestId('prominence-field');
		const triangle = page.locator('.prominence-lens-control__triangle').first();

		await page.evaluate(() => {
			performance.clearMarks();
			performance.clearMeasures();
		});
		await triangle.focus();
		for (let sample = 0; sample < 12; sample++) {
			await triangle.press(sample % 2 === 0 ? 'ArrowUp' : 'ArrowDown');
			await page.evaluate(
				() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
			);
		}
		await expect(field).toHaveAttribute('data-ranking-updating', 'false', { timeout: 5_000 });

		const samples = await page.evaluate(() => ({
			immediate: performance
				.getEntriesByName('author-prominence:immediate-ranking')
				.map((entry) => entry.duration),
			canvas: performance
				.getEntriesByName('author-prominence:canvas')
				.map((entry) => entry.duration)
		}));
		expect(samples.immediate.length).toBeGreaterThan(4);
		expect(samples.canvas.length).toBeGreaterThan(4);
		expect(percentile(samples.immediate, 0.95)).toBeLessThanOrEqual(FRAME_BUDGET_MS);
		expect(percentile(samples.canvas, 0.95)).toBeLessThanOrEqual(FRAME_BUDGET_MS);
	});
});
