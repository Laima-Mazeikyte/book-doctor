import { expect } from '@playwright/test';
import {
	openProminence,
	selectAuthorBySearch,
	selectLeaderFromMap,
	test
} from './author-prominence.fixture';

const DESKTOP = { width: 1280, height: 800 };

async function rankingNames(page: import('@playwright/test').Page): Promise<string[]> {
	return page.locator('.ranking-row__select strong').allTextContents();
}

test.describe('author prominence fallback coverage', () => {
	test.use({ viewport: DESKTOP });

	test('worker startup failure preserves the exact ranking and interaction contract', async ({
		page
	}) => {
		await openProminence(page);
		const expectedNames = await rankingNames(page);

		await page.addInitScript(() => {
			Object.defineProperty(window, 'Worker', { configurable: true, value: undefined });
		});
		await openProminence(page);

		const field = page.getByTestId('prominence-field');
		await expect(field).toHaveAttribute('data-ranking-updating', 'false');
		await expect(page.locator('.prominence-page')).toHaveAttribute(
			'data-ranking-status',
			'fallback'
		);
		expect(await rankingNames(page)).toEqual(expectedNames);

		const targetName = await field.getAttribute('data-pick-target-name');
		expect(targetName).toBeTruthy();
		await selectLeaderFromMap(page);
		await expect(page.getByTestId('prominence-inspector')).toContainText(targetName ?? '');
	});

	test('2D fallback remains populated and pickable when WebGL2 is unavailable', async ({
		page
	}) => {
		await page.addInitScript(() => {
			const original = HTMLCanvasElement.prototype.getContext;
			HTMLCanvasElement.prototype.getContext = function (type: string, attributes?: unknown) {
				if (type === 'webgl2') return null;
				return original.call(this, type, attributes as never);
			};
		});
		await openProminence(page);

		const field = page.getByTestId('prominence-field');
		await expect(field).toHaveAttribute('data-webgl-available', 'false');
		await expect(field).toHaveAttribute('data-fallback-active', 'true');
		await expect(field).toHaveAttribute('data-fallback-mode', 'settled');
		await expect(field).toHaveAttribute('data-pick-ready', 'true');
		expect(Number(await field.getAttribute('data-fallback-points'))).toBeGreaterThan(0);
		expect(Number(await field.getAttribute('data-fallback-mandatory'))).toBeGreaterThan(0);

		const targetName = await field.getAttribute('data-pick-target-name');
		expect(targetName).toBeTruthy();
		await selectLeaderFromMap(page);
		await expect(page.getByTestId('prominence-inspector')).toContainText(targetName ?? '');
	});

	test('WebGL context loss and restoration preserve selection and ranking', async ({
		page
	}, testInfo) => {
		await openProminence(page);
		const field = page.getByTestId('prominence-field');
		const overlay = field.locator('.prominence-field__overlay');
		const box = await overlay.boundingBox();
		expect(box).not.toBeNull();
		if (!box) throw new Error('The prominence field interaction surface has no layout box.');

		const target = await field.evaluate((element) => ({
			x: Number(element.getAttribute('data-pick-target-x')),
			y: Number(element.getAttribute('data-pick-target-y')),
			name: element.getAttribute('data-pick-target-name') ?? ''
		}));
		expect(target.name).toBeTruthy();

		const webglCanvas = field.locator('.prominence-field__webgl');
		let webglResources: Awaited<ReturnType<typeof webglCanvas.evaluateHandle>> | null = null;
		try {
			webglResources = await webglCanvas.evaluateHandle((canvas) => {
				const gl = canvas.getContext('webgl2');
				if (gl === null) throw new Error('WebGL2 is unavailable.');
				const extension = gl.getExtension('WEBGL_lose_context');
				if (extension === null) throw new Error('WEBGL_lose_context is unavailable.');
				return { extension };
			});
		} catch (error) {
			if (
				testInfo.project.name === 'chromium-webgl' ||
				process.env.PROMINENCE_REQUIRE_WEBGL === '1'
			)
				throw error;
			test.skip(true, `WebGL context-loss testing is unsupported: ${String(error)}`);
			return;
		}

		try {
			await page.mouse.move(box.x + target.x, box.y + target.y);
			await expect(field.locator('.prominence-field__hover')).toContainText(target.name);

			await page.evaluate((resources) => resources.extension.loseContext(), webglResources);
			await expect(field).toHaveAttribute('data-webgl-recovery', 'lost', { timeout: 5_000 });
			await expect(field).toHaveAttribute('data-fallback-active', 'true', { timeout: 5_000 });
			await expect(field).toHaveAttribute('data-pick-ready', 'true', { timeout: 5_000 });
			await expect
				.poll(async () => Number(await field.getAttribute('data-fallback-points')), {
					timeout: 5_000
				})
				.toBeGreaterThan(0);

			await page.mouse.click(box.x + target.x, box.y + target.y);
			await expect(page.getByTestId('prominence-inspector')).toContainText(target.name);
			await page.getByRole('button', { name: /Ranking/ }).click();
			await expect(page.getByTestId('prominence-ranking-panel')).toBeVisible();

			await page.evaluate((resources) => resources.extension.restoreContext(), webglResources);
			await expect(field).toHaveAttribute('data-webgl-recovery', 'available', { timeout: 10_000 });
			await expect(field).toHaveAttribute('data-webgl-available', 'true');
			await expect(field).toHaveAttribute('data-fallback-active', 'false');
			await expect(field).toHaveAttribute('data-pick-ready', 'true');
			await expect(page.getByTestId('prominence-ranking-row').first()).toBeVisible();
		} finally {
			await webglResources.dispose();
		}
	});

	test('fallback population layers stay cached across repeated hover, selection, and ranking updates', async ({
		page
	}) => {
		await page.addInitScript(() => {
			const original = HTMLCanvasElement.prototype.getContext;
			HTMLCanvasElement.prototype.getContext = function (type: string, attributes?: unknown) {
				if (type === 'webgl2') return null;
				return original.call(this, type, attributes as never);
			};
		});
		await openProminence(page);

		const field = page.getByTestId('prominence-field');
		await expect(field).toHaveAttribute('data-fallback-layer-mode', 'settled');
		await page.waitForTimeout(100);
		const initialBuilds = Number(await field.getAttribute('data-fallback-layer-builds'));
		expect(initialBuilds).toBeGreaterThan(0);

		const firstRow = page.getByTestId('prominence-ranking-row').first();
		await firstRow.hover();
		await expect
			.poll(() => field.getAttribute('data-fallback-layer-builds'))
			.toBe(String(initialBuilds));
		await firstRow.click();
		await expect(page.getByTestId('prominence-inspector')).toBeVisible();
		await expect
			.poll(() => field.getAttribute('data-fallback-layer-builds'))
			.toBe(String(initialBuilds));

		for (const name of ['A.A. Milne', '50 Cent', 'Stephen King']) {
			await page.getByRole('button', { name: /Ranking/ }).click();
			await expect(page.getByTestId('prominence-ranking-panel')).toBeVisible();
			await selectAuthorBySearch(page, name);
			await expect(page.getByTestId('prominence-inspector')).toContainText(name);
			await expect
				.poll(() => field.getAttribute('data-fallback-layer-builds'))
				.toBe(String(initialBuilds));
		}
	});
});
