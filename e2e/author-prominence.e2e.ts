import { expect, test } from '@playwright/test';

const ROUTE = '/lab/author-prominence';

async function openProminence(page: import('@playwright/test').Page): Promise<void> {
	await page.goto(ROUTE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await expect(page.getByTestId('prominence-field')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByTestId('prominence-ranking-panel')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByTestId('prominence-ranking-row').first()).toBeVisible({ timeout: 30_000 });
	const legend = page.locator('.prominence-field__legend');
	await expect(legend).toContainText('top 250');
	await expect(legend).toContainText('top 10');
	await expect(legend).not.toContainText('eligible authors');
	await expect(legend).not.toContainText('no recorded recognition');
	await expect(page.locator('.scene-note')).toHaveCount(0);
	await expect(page.getByTestId('prominence-field')).toHaveAttribute('data-pick-ready', 'true', {
		timeout: 2_000
	});
}

test.describe('author prominence desktop workbench', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('keeps the field, ranking, search, and URL state coherent', async ({ page }) => {
		const pageErrors: string[] = [];
		page.on('pageerror', (error) => pageErrors.push(error.message));
		await openProminence(page);

		await expect(page.getByTestId('prominence-ranking-row')).toHaveCount(10);
		await expect(page.locator('.prominence-ranking__header')).toHaveCount(0);
		await expect(page.getByTestId('prominence-ranking-panel')).not.toContainText('Current lens');
		await expect(page.getByTestId('prominence-ranking-panel')).not.toContainText('of 11,950');
		await expect(page.getByTestId('prominence-ranking-panel')).not.toContainText('Compared with');
		await expect(page.getByTestId('prominence-ranking-panel')).not.toContainText(
			'The score is simply the three contributions shown beneath each author'
		);
		const railOrder = await page.locator('.rail-content > *').evaluateAll((elements) =>
			elements.map((element) => {
				if (element.classList.contains('desktop-lens-module')) return 'lens';
				if (element.classList.contains('prominence-search')) return 'search';
				if (element.classList.contains('desktop-ranking-region')) return 'ranking';
				return 'other';
			})
		);
		expect(railOrder).toEqual(['lens', 'search', 'ranking']);
		await expect(page.locator('.prominence-field canvas')).toHaveCount(3);
		await expect(page.locator('.prominence-scene-panel .panel-heading')).toHaveCount(0);
		await expect(page.locator('.axis-key')).toHaveCount(0);
		await expect(page.locator('.app-footer__supplement')).toHaveText('Release v1');
		await expect(page.locator('.lens-mixer')).not.toContainText('Prominence lens');
		await expect(page.locator('.lens-mixer')).not.toContainText('Try a lens');
		const featureInfo = page.locator('.lens-mixer__share .lens-mixer__info');
		await expect(featureInfo).toHaveCount(3);
		await featureInfo.first().hover();
		await expect(page.locator('.lens-mixer__info-popover--visible').first()).toBeVisible();
		await featureInfo.first().click();
		await expect(featureInfo.first()).toHaveAttribute('aria-expanded', 'true');
		await featureInfo.first().press('Escape');
		await expect(featureInfo.first()).toHaveAttribute('aria-expanded', 'false');
		const presetInfo = page.getByTestId('lens-preset-info');
		await expect(presetInfo).toHaveCount(4);
		await presetInfo.first().hover();
		const presetPopover = page.locator(
			'.lens-mixer__preset-info-wrap .lens-mixer__info-popover--visible'
		);
		await expect(presetPopover).toBeVisible();
		await expect(presetPopover).toContainText(
			'The tested default. Chosen by sweeping the weight space and picking the setting where no author reaches the top on a single feature alone.'
		);
		await presetInfo.first().click();
		await expect(presetInfo.first()).toHaveAttribute('aria-expanded', 'true');
		await presetInfo.first().press('Escape');
		await expect(presetInfo.first()).toHaveAttribute('aria-expanded', 'false');
		await expect(page.locator('.prominence-method__intro')).toHaveCount(0);
		const mapInfo = page.locator('.prominence-field__info');
		await expect(mapInfo).toHaveCount(1);
		const mapInfoWrapBox = await page.locator('.prominence-field__info-wrap').boundingBox();
		const mapActionsBox = await page.locator('.prominence-field__actions').boundingBox();
		expect(mapInfoWrapBox).not.toBeNull();
		expect(mapActionsBox).not.toBeNull();
		if (mapInfoWrapBox && mapActionsBox) {
			expect(
				mapActionsBox.x + mapActionsBox.width - (mapInfoWrapBox.x + mapInfoWrapBox.width)
			).toBeLessThan(40);
		}
		await expect(page.locator('.prominence-rail')).toHaveCSS('overflow', 'visible');
		await expect(page.locator('.rail-content')).toHaveCSS('overflow', 'visible');
		await mapInfo.hover();
		const mapInfoPopover = page.locator('.prominence-field__info-popover--visible');
		await expect(mapInfoPopover).toBeVisible();
		await expect(mapInfoPopover).toContainText('How to read this');
		await expect(mapInfoPopover).toContainText('Axes: Position relative to an average author.');
		await expect(mapInfoPopover).toContainText(
			'Lens: Weighted feature importance toward the composite score.'
		);
		await mapInfo.click();
		await expect(mapInfo).toHaveAttribute('aria-expanded', 'true');
		await mapInfo.press('Escape');
		await expect(mapInfo).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByRole('combobox', { name: 'Author search' })).toBeVisible();
		await expect(page.locator('.screen-reader-only').first()).toHaveCSS('position', 'absolute');

		const regardSlider = page.locator('.lens-mixer input[type="range"]').first();
		const startingShare = await regardSlider.inputValue();
		const sliderBox = await regardSlider.boundingBox();
		expect(sliderBox).not.toBeNull();
		if (sliderBox) {
			await page.mouse.move(
				sliderBox.x + sliderBox.width * 0.35,
				sliderBox.y + sliderBox.height / 2
			);
			await page.mouse.down();
			await page.mouse.move(
				sliderBox.x + sliderBox.width * 0.55,
				sliderBox.y + sliderBox.height / 2
			);
		}
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await expect(regardSlider).toHaveValue(startingShare);
		await expect(page.getByTestId('prominence-field')).toHaveAttribute(
			'data-ranking-updating',
			'false'
		);

		const field = page.getByTestId('prominence-field');
		const overlay = field.locator('.prominence-field__overlay');
		const box = await overlay.boundingBox();
		expect(box).not.toBeNull();
		if (box) {
			await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.56, {
				steps: 4
			});
			await page.mouse.up();
			await expect(field).toHaveAttribute('data-camera-moving', 'false');
			await expect(field).toHaveAttribute('data-pick-ready', 'true', { timeout: 2_000 });
		}
		if (box) {
			await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
			await page.mouse.wheel(0, 160);
			await expect(field).toHaveAttribute('data-camera-moving', 'false');
			await expect(field).toHaveAttribute('data-pick-ready', 'true', { timeout: 2_000 });
		}

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(field).toHaveAttribute('data-pick-ready', 'true', { timeout: 2_000 });

		const preset = page.getByRole('button', { name: /Most read/ }).first();
		await preset.click();
		await expect(page).toHaveURL(/lens=Most(?:%20|\+)read/);
		await expect(page.getByTestId('prominence-ranking-panel')).toHaveAttribute(
			'data-row-motion-intent',
			'preset'
		);
		const rowKeys = await page
			.getByTestId('prominence-ranking-panel')
			.locator('li[data-author-index]')
			.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-author-index')));
		expect(new Set(rowKeys).size).toBe(rowKeys.length);
		const presetUrl = page.url();
		await page
			.getByRole('button', { name: /Reader favourites/ })
			.first()
			.click();
		await page.goBack();
		await expect(page).toHaveURL(presetUrl);
		await expect(preset).toHaveAttribute('aria-pressed', 'true');

		const search = page.getByRole('combobox', { name: 'Author search' });
		await search.fill('king');
		const listbox = page.getByRole('listbox');
		await expect(listbox).toBeVisible();
		await expect(listbox.getByRole('option')).toHaveCount(8);
		await expect(listbox).toContainText('Stephen King');
		await search.press('Home');
		await expect(search).toHaveAttribute('aria-activedescendant', /author-option-/);
		await search.press('Enter');
		const inspector = page.getByTestId('prominence-inspector');
		await expect(inspector).toBeVisible({ timeout: 2_000 });
		await expect(inspector).not.toContainText('Compared with');
		await expect(inspector).not.toContainText('ahead of');
		await expect(inspector).not.toContainText('↑');
		await expect(inspector).not.toContainText('descriptive, not a verdict');
		await expect(inspector).not.toContainText(
			'Audience concentration describes this audience only'
		);
		await expect(inspector).not.toContainText('same author, different emphasis');
		await expect(page).toHaveURL(/author=/);
		await expect(pageErrors).toEqual([]);
	});
});

test('preset ranking changes animate keyed rows and preserve row identity', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await openProminence(page);
	const panel = page.getByTestId('prominence-ranking-panel');
	const rows = panel.locator('li[data-author-index]');
	const beforeHandles = await rows.elementHandles();
	const beforeKeys = await Promise.all(
		beforeHandles.map((handle) => handle.getAttribute('data-author-index'))
	);

	await page
		.getByRole('button', { name: /Most read/ })
		.first()
		.click();
	await expect(panel).toHaveAttribute('data-row-motion-intent', 'preset');
	await expect(panel).toHaveAttribute('data-row-motion-duration', '260');
	await expect
		.poll(async () => {
			const keys = await rows.evaluateAll((items) =>
				items.map((item) => item.getAttribute('data-author-index'))
			);
			return keys.join(',') !== beforeKeys.join(',');
		})
		.toBe(true);
	await expect
		.poll(async () =>
			rows.evaluateAll((items) =>
				items.some((item) =>
					item.getAnimations().some((animation) => animation.playState === 'running')
				)
			)
		)
		.toBe(true);

	const afterKeys = await rows.evaluateAll((items) =>
		items.map((item) => item.getAttribute('data-author-index'))
	);
	const commonKey = beforeKeys.find((key) => key !== null && afterKeys.includes(key));
	expect(commonKey).not.toBeUndefined();
	if (commonKey !== undefined && commonKey !== null) {
		const handle = beforeHandles[beforeKeys.indexOf(commonKey)];
		const preserved = await handle.evaluate((node, key) => {
			const current = Array.from(document.querySelectorAll('li[data-author-index]')).find(
				(item) => item.getAttribute('data-author-index') === key
			);
			return current === node;
		}, commonKey);
		expect(preserved).toBe(true);
	}
});

test('committed slider changes use the shorter row animation', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await openProminence(page);
	const panel = page.getByTestId('prominence-ranking-panel');
	const rows = panel.locator('li[data-author-index]');
	const beforeKeys = await rows.evaluateAll((items) =>
		items.map((item) => item.getAttribute('data-author-index'))
	);
	const slider = page.locator('.lens-mixer input[type="range"]').first();
	const sliderBox = await slider.boundingBox();
	expect(sliderBox).not.toBeNull();
	if (!sliderBox) throw new Error('The regard slider has no layout box.');

	await page.mouse.move(sliderBox.x + sliderBox.width * 0.35, sliderBox.y + sliderBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(sliderBox.x + sliderBox.width * 0.02, sliderBox.y + sliderBox.height / 2, {
		steps: 8
	});
	await page.mouse.up();

	await expect(panel).toHaveAttribute('data-row-motion-intent', 'commit');
	await expect(panel).toHaveAttribute('data-row-motion-duration', '150');
	await expect
		.poll(async () => {
			const keys = await rows.evaluateAll((items) =>
				items.map((item) => item.getAttribute('data-author-index'))
			);
			return keys.join(',') !== beforeKeys.join(',');
		})
		.toBe(true);
	await expect
		.poll(async () =>
			rows.evaluateAll((items) =>
				items.some((item) =>
					item.getAnimations().some((animation) => animation.playState === 'running')
				)
			)
		)
		.toBe(true);
});

test('reduced motion updates ranking order without starting row animation', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.setViewportSize({ width: 1280, height: 800 });
	await openProminence(page);
	const panel = page.getByTestId('prominence-ranking-panel');
	const rows = panel.locator('li[data-author-index]');
	const beforeKeys = await rows.evaluateAll((items) =>
		items.map((item) => item.getAttribute('data-author-index'))
	);

	await page
		.getByRole('button', { name: /Most read/ })
		.first()
		.click();
	await expect(panel).toHaveAttribute('data-row-motion-intent', 'preset');
	await expect(panel).toHaveAttribute('data-row-motion-duration', '0');
	await expect
		.poll(async () => {
			const keys = await rows.evaluateAll((items) =>
				items.map((item) => item.getAttribute('data-author-index'))
			);
			return keys.join(',') !== beforeKeys.join(',');
		})
		.toBe(true);
	await expect
		.poll(async () =>
			rows.evaluateAll(
				(items) => items.length && items.every((item) => item.getAnimations().length === 0)
			)
		)
		.toBe(true);
});

test('selected inspector stays mounted and tracks the draft lens while ranking is delayed', async ({
	page
}) => {
	await page.addInitScript(() => {
		const NativeWorker = window.Worker;
		class DelayedWorker extends NativeWorker {
			constructor(scriptURL: string | URL, options?: WorkerOptions) {
				super(scriptURL, options);
				let handler: ((event: MessageEvent) => void) | null = null;
				Object.defineProperty(this, 'onmessage', {
					configurable: true,
					get: () => handler,
					set: (next: ((event: MessageEvent) => void) | null) => {
						handler = next;
					}
				});
				this.addEventListener('message', (event) => {
					window.setTimeout(() => {
						if (handler) handler(event as MessageEvent);
					}, 300);
				});
			}
		}
		window.Worker = DelayedWorker;
	});
	await page.setViewportSize({ width: 1280, height: 800 });
	await openProminence(page);
	const firstRow = page.getByTestId('prominence-ranking-row').first();
	await firstRow.click();
	const inspector = page.getByTestId('prominence-inspector');
	await expect(inspector).toBeVisible();
	const field = page.getByTestId('prominence-field');
	await expect(field).toHaveAttribute('data-ranking-updating', 'false', { timeout: 5_000 });
	const inspectorHandle = await inspector.elementHandle();
	const beforeScore = await inspector.getAttribute('data-selected-score');
	const beforeShares = await inspector.getAttribute('data-display-shares');

	const slider = page.locator('.lens-mixer input[type="range"]').first();
	await slider.dispatchEvent('pointerdown');
	await slider.evaluate((node) => {
		const input = node as HTMLInputElement;
		input.value = input.value === '1' ? '2' : '1';
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});

	await expect(field).toHaveAttribute('data-ranking-updating', 'true', { timeout: 1_000 });
	await expect(field).toHaveAttribute('data-ranking-progress-visible', 'false');
	await expect(inspector).toBeVisible();
	await expect(inspector).toContainText('Current composition');
	await expect(inspector).not.toContainText('Updating the selected author');
	const duringScore = await inspector.getAttribute('data-selected-score');
	const duringShares = await inspector.getAttribute('data-display-shares');
	expect(duringScore).not.toBe(beforeScore);
	expect(duringShares).not.toBe(beforeShares);
	if (inspectorHandle) {
		expect(await inspector.evaluate((node, handle) => node === handle, inspectorHandle)).toBe(true);
	}

	await slider.dispatchEvent('change');
	await expect(field).toHaveAttribute('data-ranking-progress-visible', 'true', { timeout: 1_000 });
	await expect(field.locator('.prominence-field__status')).toContainText('updating ranking');
	await expect(field).toHaveAttribute('data-ranking-updating', 'false', { timeout: 5_000 });
	await expect(inspector).toBeVisible();
});

test('coalesces live lens calculation and stays within the browser frame budget', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await openProminence(page);
	await page.getByTestId('prominence-ranking-row').first().click();
	const field = page.getByTestId('prominence-field');
	await expect(page.getByTestId('prominence-inspector')).toBeVisible();
	await expect(field).toHaveAttribute('data-ranking-updating', 'false', { timeout: 5_000 });

	const trace = async (selector: string, eventName: 'pointermove' | 'input') => {
		await page.evaluate(
			({ selector: currentSelector, event: currentEvent }) => {
				const target = document.querySelector(currentSelector);
				if (!target) throw new Error(`Missing interaction target: ${currentSelector}`);
				const state = window as Window & {
					__prominenceLensTrace?: { rawEvents: number };
				};
				state.__prominenceLensTrace = { rawEvents: 0 };
				target.addEventListener(currentEvent, () => {
					if (state.__prominenceLensTrace) state.__prominenceLensTrace.rawEvents += 1;
				});
				performance.clearMeasures('author-prominence:immediate-ranking');
				performance.clearMeasures('author-prominence:lens-derivation');
			},
			{ selector, event: eventName }
		);

		const target = page.locator(selector).first();
		const box = await target.boundingBox();
		expect(box).not.toBeNull();
		if (!box) throw new Error(`Missing layout box for ${selector}`);
		if (eventName === 'pointermove') {
			await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width * 0.02, box.y + box.height * 0.5, {
				steps: 40
			});
			await page.mouse.up();
		} else {
			await target.dispatchEvent('pointerdown');
			await target.evaluate((node) => {
				const input = node as HTMLInputElement;
				for (let value = 1; value <= 40; value++) {
					input.value = String(value % 40);
					input.dispatchEvent(new Event('input', { bubbles: true }));
				}
			});
			await page.evaluate(
				() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
			);
			await target.dispatchEvent('change');
		}
		await expect(field).toHaveAttribute('data-ranking-updating', 'false', { timeout: 5_000 });
		return page.evaluate(() => {
			const state = window as Window & {
				__prominenceLensTrace?: { rawEvents: number };
			};
			const durations = performance
				.getEntriesByName('author-prominence:immediate-ranking')
				.map((entry) => entry.duration)
				.sort((a, b) => a - b);
			const derivations = performance.getEntriesByName('author-prominence:lens-derivation');
			return {
				rawEvents: state.__prominenceLensTrace?.rawEvents ?? 0,
				derivations: derivations.length,
				calculations: durations.length,
				p95:
					durations[
						durations.length
							? Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)
							: 0
					] ?? 0
			};
		});
	};

	const triangleTrace = await trace('.lens-mixer__triangle', 'pointermove');
	expect(triangleTrace.rawEvents).toBeGreaterThan(10);
	expect(triangleTrace.calculations).toBeGreaterThan(0);
	expect(triangleTrace.p95).toBeLessThanOrEqual(16.7);

	const sliderTrace = await trace('.lens-mixer input[type="range"]', 'input');
	expect(sliderTrace.rawEvents).toBeGreaterThan(10);
	expect(sliderTrace.derivations).toBeLessThan(sliderTrace.rawEvents);
	expect(sliderTrace.calculations).toBeLessThanOrEqual(sliderTrace.derivations);
	expect(sliderTrace.calculations).toBeGreaterThan(0);
	expect(sliderTrace.p95).toBeLessThanOrEqual(16.7);
});

for (const width of [320, 390, 600, 768]) {
	test(`mobile destination panels remain visible at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await openProminence(page);

		const panel = page.locator('[role="tabpanel"]');
		const rankingTab = page.getByRole('tab', { name: 'Ranking' });
		await expect(rankingTab).toHaveAttribute('aria-selected', 'true');
		await expect(panel).toHaveCount(1);
		await expect(page.locator('#prominence-panel-ranking')).toBeVisible();

		await page.getByRole('tab', { name: 'Lens' }).click();
		await expect(page.locator('#prominence-panel-lens')).toBeVisible();
		await expect(page.locator('[role="tabpanel"]')).toHaveCount(1);
		const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
		const featureInfo = page.locator('.lens-mixer__share .lens-mixer__info').first();
		await featureInfo.hover();
		const featurePopover = page.locator('.lens-mixer__info-popover--visible').first();
		await expect(featurePopover).toBeVisible();
		const featurePopoverGeometry = await featurePopover.evaluate((element) => {
			const rect = element.getBoundingClientRect();
			return { left: rect.left, right: rect.right };
		});
		expect(featurePopoverGeometry.left).toBeGreaterThanOrEqual(0);
		expect(featurePopoverGeometry.right).toBeLessThanOrEqual(viewportWidth);
		const presetInfo = page.getByTestId('lens-preset-info').first();
		await presetInfo.hover();
		const presetPopover = page.locator('.lens-mixer__info-popover--visible').first();
		await expect(presetPopover).toBeVisible();
		const presetPopoverGeometry = await presetPopover.evaluate((element) => {
			const rect = element.getBoundingClientRect();
			return { left: rect.left, right: rect.right };
		});
		expect(presetPopoverGeometry.left).toBeGreaterThanOrEqual(0);
		expect(presetPopoverGeometry.right).toBeLessThanOrEqual(viewportWidth);
		const mapInfo = page.locator('.prominence-field__info');
		await mapInfo.hover();
		const mapPopover = page.locator('.prominence-field__info-popover--visible');
		await expect(mapPopover).toBeVisible();
		const mapPopoverGeometry = await mapPopover.evaluate((element) => {
			const rect = element.getBoundingClientRect();
			return { left: rect.left, right: rect.right };
		});
		expect(mapPopoverGeometry.left).toBeGreaterThanOrEqual(0);
		expect(mapPopoverGeometry.right).toBeLessThanOrEqual(viewportWidth);

		const method = page.locator('.method-details');
		const methodSummary = method.getByText('Method and limitations');
		await expect(methodSummary).toBeVisible();
		await methodSummary.click();
		await expect(method).toHaveAttribute('open', '');
		await expect(method.locator('.method-details__body')).toContainText('Eligibility:');
		await expect(method.locator('.method-details__body')).toContainText('Interpretation:');
		await expect(page.locator('.prominence-provenance')).toHaveCount(0);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await page.getByRole('tab', { name: 'Lens' }).click();
		await expect(method).toHaveAttribute('open', '');

		await rankingTab.click();
		await expect(page.locator('#prominence-panel-ranking')).toBeVisible();
		await page.getByTestId('prominence-ranking-row').first().click();
		await expect(page.getByRole('tab', { name: 'Selected author' })).toBeVisible();
		await expect(page.locator('#prominence-panel-author')).toBeVisible({ timeout: 2_000 });
		await expect(page.locator('[role="tabpanel"]')).toHaveCount(1);

		await rankingTab.click();
		await expect(page.locator('#prominence-panel-ranking')).toBeVisible();
		await page.getByRole('tab', { name: 'Selected author' }).click();
		await page.getByTestId('prominence-inspector').getByRole('button', { name: 'Clear' }).click();
		await expect(page.getByRole('tab', { name: 'Selected author' })).toHaveCount(0);
		await expect(page.locator('#prominence-panel-ranking')).toBeVisible();
	});
}

test('WebGL context loss leaves the field usable', async ({ page }, testInfo) => {
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	await page.addInitScript(() => {
		const state = window as Window & { __prominenceUnhandledRejections?: string[] };
		window.addEventListener('unhandledrejection', (event) => {
			(state.__prominenceUnhandledRejections ??= []).push(String(event.reason));
		});
	});
	await page.setViewportSize({ width: 1280, height: 800 });
	await openProminence(page);
	const field = page.getByTestId('prominence-field');
	const overlay = field.locator('.prominence-field__overlay');
	const box = await overlay.boundingBox();
	expect(box).not.toBeNull();
	if (!box) throw new Error('The prominence field interaction surface has no layout box.');

	const target = await field.evaluate((element) => ({
		x: Number(element.getAttribute('data-pick-target-x')),
		y: Number(element.getAttribute('data-pick-target-y')),
		name: element.getAttribute('data-pick-target-name')
	}));
	if (!target.name) throw new Error('The prominence field did not expose a known pick target.');

	const webglCanvas = field.locator('.prominence-field__webgl');
	let webglResources: Awaited<ReturnType<typeof webglCanvas.evaluateHandle>> | null = null;
	try {
		webglResources = await webglCanvas.evaluateHandle((canvas) => {
			const gl = canvas.getContext('webgl2');
			if (gl === null) throw new Error('WebGL2 is unavailable.');
			const extension = gl.getExtension('WEBGL_lose_context');
			if (extension === null) throw new Error('WEBGL_lose_context is unavailable.');
			return { gl, extension };
		});
	} catch (error) {
		const requiresWebgl =
			testInfo.project.name === 'chromium-webgl' || process.env.PROMINENCE_REQUIRE_WEBGL === '1';
		if (requiresWebgl) throw error;
		test.skip(true, `WebGL context-loss testing is unsupported: ${String(error)}`);
		return;
	}

	try {
		await page.mouse.move(box.x + target.x, box.y + target.y);
		const hover = field.locator('.prominence-field__hover');
		await expect(hover).toContainText(target.name);
		await expect(hover).toContainText('#');
		await expect(hover).not.toContainText('recognition');

		await page.evaluate((resources) => {
			resources.extension.loseContext();
		}, webglResources);
		await expect(field).toHaveAttribute('data-webgl-recovery', 'lost', { timeout: 5_000 });
		await expect(field).toHaveAttribute('data-fallback-active', 'true', { timeout: 5_000 });
		await expect(field).toHaveAttribute('data-pick-ready', 'true', { timeout: 5_000 });
		await expect(field).toHaveAttribute('data-fallback-mode', /sample|settled/);
		await expect
			.poll(async () => Number(await field.getAttribute('data-fallback-points')), {
				timeout: 5_000
			})
			.toBeGreaterThan(0);
		await expect(page.getByTestId('prominence-ranking-row').first()).toBeVisible();

		await page.mouse.move(box.x + target.x, box.y + target.y);
		await expect(hover).toContainText(target.name);
		await page.mouse.down();
		await page.mouse.up();
		await expect(page.getByTestId('prominence-inspector')).toContainText(target.name);
		await page.getByTestId('prominence-inspector').getByRole('button', { name: 'Clear' }).click();
		await expect(page.getByTestId('prominence-ranking-panel')).toBeVisible();
		await expect(page.getByTestId('prominence-ranking-row').first()).toBeVisible();
		await page.mouse.move(box.x + target.x, box.y + target.y);
		await page.mouse.down();
		await page.mouse.up();
		await expect(page.getByTestId('prominence-inspector')).toContainText(target.name);

		await page.evaluate((resources) => {
			resources.extension.restoreContext();
		}, webglResources);
		await expect(field).toHaveAttribute('data-webgl-recovery', 'available', { timeout: 10_000 });
		await expect(field).toHaveAttribute('data-webgl-available', 'true');
		await expect(field).toHaveAttribute('data-fallback-active', 'false');
		await expect(field).toHaveAttribute('data-pick-ready', 'true');
		await expect(page.getByTestId('prominence-inspector')).toContainText(target.name);

		const unhandledRejections = await page.evaluate(
			() =>
				(window as Window & { __prominenceUnhandledRejections?: string[] })
					.__prominenceUnhandledRejections ?? []
		);
		expect(pageErrors).toEqual([]);
		expect(unhandledRejections).toEqual([]);
	} finally {
		await webglResources.dispose();
	}
});

test('2D fallback stays populated and pickable when WebGL2 is unavailable', async ({ page }) => {
	await page.addInitScript(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (type: string, attributes?: unknown) {
			if (type === 'webgl2') return null;
			return original.call(this, type, attributes as never);
		};
	});
	await page.setViewportSize({ width: 1280, height: 800 });
	await openProminence(page);
	const field = page.getByTestId('prominence-field');
	await expect(field).toHaveAttribute('data-webgl-available', 'false');
	await expect(field).toHaveAttribute('data-fallback-active', 'true');
	expect(Number(await field.getAttribute('data-fallback-points'))).toBeGreaterThan(0);
	expect(Number(await field.getAttribute('data-fallback-mandatory'))).toBeGreaterThan(0);
	expect(await field.getAttribute('data-fallback-mode')).toBe('settled');
	expect(Number(await field.getAttribute('data-fallback-frame'))).toBeGreaterThan(0);
	const overlay = field.locator('.prominence-field__overlay');
	const box = await overlay.boundingBox();
	expect(box).not.toBeNull();
	if (box) {
		const target = await field.evaluate((element) => ({
			x: Number(element.getAttribute('data-pick-target-x')),
			y: Number(element.getAttribute('data-pick-target-y')),
			name: element.getAttribute('data-pick-target-name') ?? ''
		}));
		await page.mouse.move(box.x + target.x, box.y + target.y);
		await expect(field.locator('.prominence-field__hover')).toContainText(target.name);
		await page.mouse.down();
		await page.mouse.up();
		await expect(page.getByTestId('prominence-inspector')).toContainText(target.name);
		await page.getByTestId('prominence-inspector').getByRole('button', { name: 'Clear' }).click();
		await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.52, { steps: 3 });
		await expect(field).toHaveAttribute('data-fallback-points', /[1-9]/);
		await page.mouse.up();
	}
	await expect(field).toHaveAttribute('data-pick-ready', 'true', { timeout: 2_000 });
	await expect(field).toHaveAttribute('data-fallback-mode', 'settled');
	if (box) {
		const target = await field.evaluate((element) => ({
			x: Number(element.getAttribute('data-pick-target-x')),
			y: Number(element.getAttribute('data-pick-target-y')),
			name: element.getAttribute('data-pick-target-name') ?? ''
		}));
		await page.mouse.move(box.x + target.x, box.y + target.y);
		await expect(field.locator('.prominence-field__hover')).toContainText(target.name);
		await page.mouse.down();
		await page.mouse.up();
		await expect(page.getByTestId('prominence-inspector')).toContainText(target.name);
	}
});

test('fallback population layers are cached across overlay and ranking changes', async ({
	page
}) => {
	await page.addInitScript(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (type: string, attributes?: unknown) {
			if (type === 'webgl2') return null;
			return original.call(this, type, attributes as never);
		};
	});
	await page.setViewportSize({ width: 1280, height: 800 });
	await openProminence(page);
	const field = page.getByTestId('prominence-field');
	await expect(field).toHaveAttribute('data-fallback-layer-mode', 'settled');
	await expect(field).toHaveAttribute('data-fallback-settled-builds', '1');
	const initialBuilds = Number(await field.getAttribute('data-fallback-layer-builds'));
	const initialSettledBuilds = Number(await field.getAttribute('data-fallback-settled-builds'));

	const overlay = field.locator('.prominence-field__overlay');
	const box = await overlay.boundingBox();
	expect(box).not.toBeNull();
	if (!box) throw new Error('The fallback interaction surface has no layout box.');
	const target = await field.evaluate((element) => ({
		x: Number(element.getAttribute('data-pick-target-x')),
		y: Number(element.getAttribute('data-pick-target-y')),
		name: element.getAttribute('data-pick-target-name') ?? ''
	}));
	await page.mouse.move(box.x + target.x, box.y + target.y);
	await expect(field.locator('.prominence-field__hover')).toContainText(target.name);
	expect(Number(await field.getAttribute('data-fallback-layer-builds'))).toBe(initialBuilds);

	await page.mouse.down();
	await page.mouse.up();
	await expect(page.getByTestId('prominence-inspector')).toContainText(target.name);
	expect(Number(await field.getAttribute('data-fallback-layer-builds'))).toBe(initialBuilds);
	await page.getByTestId('prominence-inspector').getByRole('button', { name: 'Clear' }).click();
	await expect(page.getByTestId('prominence-ranking-panel')).toBeVisible();
	expect(Number(await field.getAttribute('data-fallback-layer-builds'))).toBe(initialBuilds);

	await page
		.getByRole('button', { name: /Most read/ })
		.first()
		.click();
	await expect(field).toHaveAttribute('data-ranking-updating', 'false', { timeout: 5_000 });
	await expect(field).toHaveAttribute('data-fallback-layer-mode', 'settled');
	expect(Number(await field.getAttribute('data-fallback-layer-builds'))).toBe(initialBuilds);
	expect(Number(await field.getAttribute('data-fallback-settled-builds'))).toBe(
		initialSettledBuilds
	);

	const slider = page.locator('.lens-mixer input[type="range"]').first();
	const sliderBox = await slider.boundingBox();
	expect(sliderBox).not.toBeNull();
	if (!sliderBox) throw new Error('The regard slider has no layout box.');
	await page.mouse.move(sliderBox.x + sliderBox.width * 0.35, sliderBox.y + sliderBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(sliderBox.x + sliderBox.width * 0.08, sliderBox.y + sliderBox.height / 2, {
		steps: 6
	});
	await expect(field).toHaveAttribute('data-fallback-layer-mode', 'sample');
	const sampleBuilds = Number(await field.getAttribute('data-fallback-layer-builds'));
	expect(sampleBuilds).toBeGreaterThan(initialBuilds);
	await page.mouse.up();
	await expect(field).toHaveAttribute('data-fallback-layer-mode', 'settled');
	const postLensBuilds = Number(await field.getAttribute('data-fallback-layer-builds'));
	expect(postLensBuilds).toBeGreaterThan(sampleBuilds);

	await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.56, { steps: 5 });
	await page.mouse.up();
	await expect(field).toHaveAttribute('data-camera-moving', 'false');
	await expect(field).toHaveAttribute('data-pick-ready', 'true', { timeout: 2_000 });
	await expect(field).toHaveAttribute('data-fallback-layer-mode', 'settled');
	await expect
		.poll(async () => Number(await field.getAttribute('data-fallback-layer-builds')))
		.toBeGreaterThan(postLensBuilds);
	const postCameraBuilds = Number(await field.getAttribute('data-fallback-layer-builds'));

	await page.setViewportSize({ width: 1100, height: 800 });
	await expect(field).toHaveAttribute('data-pick-ready', 'true', { timeout: 2_000 });
	await expect(field).toHaveAttribute('data-fallback-layer-mode', 'settled');
	await expect
		.poll(async () => Number(await field.getAttribute('data-fallback-layer-builds')))
		.toBeGreaterThan(postCameraBuilds);
});

test('fallback performance smoke stays populated and pickable within resilient budgets', async ({
	page
}) => {
	await page.addInitScript(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (type: string, attributes?: unknown) {
			if (type === 'webgl2') return null;
			return original.call(this, type, attributes as never);
		};
	});
	await page.setViewportSize({ width: 1280, height: 800 });
	await openProminence(page);
	await page.waitForTimeout(250);

	await page.evaluate(() => {
		const state = window as Window & {
			__prominenceFallbackTrace?: {
				active: boolean;
				frames: number[];
				longTasks: number[];
				invalidFrames: number;
				observer: PerformanceObserver | null;
			};
		};
		const trace = {
			active: true,
			frames: [] as number[],
			longTasks: [] as number[],
			invalidFrames: 0,
			observer: null as PerformanceObserver | null
		};
		state.__prominenceFallbackTrace = trace;
		try {
			trace.observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) trace.longTasks.push(entry.duration);
			});
			trace.observer.observe({ type: 'longtask' });
		} catch {
			trace.observer = null;
		}
		let previous = performance.now();
		const sampleFrame = (now: number) => {
			if (!trace.active) return;
			trace.frames.push(now - previous);
			previous = now;
			const field = document.querySelector('[data-testid="prominence-field"]');
			if (
				field?.getAttribute('data-fallback-active') !== 'true' ||
				Number(field.getAttribute('data-fallback-points')) <= 0
			)
				trace.invalidFrames += 1;
			requestAnimationFrame(sampleFrame);
		};
		requestAnimationFrame(sampleFrame);
	});

	const field = page.getByTestId('prominence-field');
	const overlay = field.locator('.prominence-field__overlay');
	const box = await overlay.boundingBox();
	expect(box).not.toBeNull();
	if (!box) throw new Error('The fallback interaction surface has no layout box.');
	await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.42);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.55, { steps: 10 });
	await page.mouse.up();
	await page.mouse.wheel(0, 120);
	await expect(field).toHaveAttribute('data-pick-ready', 'true', { timeout: 2_000 });

	const slider = page.locator('.lens-mixer input[type="range"]').first();
	const sliderBox = await slider.boundingBox();
	expect(sliderBox).not.toBeNull();
	if (!sliderBox) throw new Error('The regard slider has no layout box.');
	await page.mouse.move(sliderBox.x + sliderBox.width * 0.35, sliderBox.y + sliderBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(sliderBox.x + sliderBox.width * 0.2, sliderBox.y + sliderBox.height / 2, {
		steps: 10
	});
	await page.mouse.up();
	await expect(field).toHaveAttribute('data-fallback-layer-mode', 'settled');
	await page.waitForTimeout(250);

	const trace = await page.evaluate(() => {
		const state = window as Window & {
			__prominenceFallbackTrace?: {
				active: boolean;
				frames: number[];
				longTasks: number[];
				invalidFrames: number;
				observer: PerformanceObserver | null;
			};
		};
		const current = state.__prominenceFallbackTrace;
		if (!current) throw new Error('Fallback performance trace was not initialized.');
		current.active = false;
		current.observer?.disconnect();
		const frames = current.frames.slice().sort((a, b) => a - b);
		return {
			frameCount: frames.length,
			p95:
				frames[
					frames.length ? Math.min(frames.length - 1, Math.ceil(frames.length * 0.95) - 1) : 0
				] ?? 0,
			maximumLongTask: Math.max(0, ...current.longTasks),
			invalidFrames: current.invalidFrames
		};
	});
	expect(trace.frameCount).toBeGreaterThan(10);
	expect(trace.p95).toBeLessThanOrEqual(40);
	expect(trace.maximumLongTask).toBeLessThanOrEqual(50);
	expect(trace.invalidFrames).toBe(0);
	await expect(field).toHaveAttribute('data-fallback-active', 'true');
	await expect
		.poll(async () => Number(await field.getAttribute('data-fallback-points')))
		.toBeGreaterThan(0);
});

test('worker startup failure falls back to the same exact ranking contract', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, 'Worker', { configurable: true, value: undefined });
	});
	await page.setViewportSize({ width: 1280, height: 800 });
	await openProminence(page);
	await expect(page.getByTestId('prominence-ranking-row')).toHaveCount(10);
	await expect(page.getByTestId('prominence-field')).toHaveAttribute(
		'data-ranking-updating',
		'false'
	);
});
