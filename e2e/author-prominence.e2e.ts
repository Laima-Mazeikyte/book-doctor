import { expect } from '@playwright/test';
import {
	openProminence,
	selectAuthorBySearch,
	selectLeaderFromMap,
	test
} from './author-prominence.fixture';

async function dragTriangle(
	page: import('@playwright/test').Page,
	end: { x: number; y: number }
): Promise<void> {
	const triangle = page.locator('.prominence-lens-control__triangle').first();
	const box = await triangle.boundingBox();
	if (!box) throw new Error('The triangle has no layout box.');
	const start = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.58 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * end.x, box.y + box.height * end.y, { steps: 8 });
	await page.mouse.up();
}

test.describe('author prominence desktop workbench', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('keeps the map stack, lean rail and public lens contract', async ({ page }) => {
		await openProminence(page);

		await expect(page.locator('input[type="range"]')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Balanced', exact: true })).toHaveCount(0);
		await expect(page.locator('body')).not.toContainText(
			/Reader favourites|Most read|Most decorated/
		);
		await expect(page.locator('.prominence-map-stack .prominence-lens-control')).toHaveCount(1);
		await expect(page.locator('.prominence-rail .prominence-lens-control')).toHaveCount(0);
		await expect(page.locator('.prominence-ranking__list > li')).toHaveCount(15);
		await expect(page.locator('.ranking-row__select .prominence-contribution')).toHaveCount(0);
		await expect(page.locator('.prominence-ranking')).not.toContainText('no recorded recognition');

		const stack = await page.locator('.prominence-map-stack').boundingBox();
		const triangle = await page.locator('.prominence-lens-control__triangle').boundingBox();
		const actions = await page.locator('.prominence-field__actions').boundingBox();
		expect(stack).not.toBeNull();
		expect(triangle).not.toBeNull();
		expect(actions).not.toBeNull();
		if (stack && triangle && actions) {
			expect(triangle.x).toBeGreaterThan(stack.x);
			expect(triangle.x + triangle.width).toBeLessThanOrEqual(stack.x + stack.width + 1);
			expect(triangle.y + triangle.height).toBeLessThan(actions.y + 10);
		}
		await expect(page.locator('.prominence-field canvas')).toHaveCount(3);
		const plot = await page.locator('.prominence-field').boundingBox();
		const search = await page.locator('.rail-content > .prominence-search').boundingBox();
		expect(plot).not.toBeNull();
		expect(search).not.toBeNull();
		if (plot && search) expect(Math.abs(search.y - plot.y)).toBeLessThanOrEqual(1);
		await expect(page.locator('.rail-content > .ranking-region')).toHaveCount(1);
	});

	test('dragging and keyboard control update the simplex without moving the map', async ({
		page
	}) => {
		await openProminence(page);
		const triangle = page.locator('.prominence-lens-control__triangle').first();
		const field = page.getByTestId('prominence-field');
		const balancedLabel = await triangle.getAttribute('aria-label');
		const before = await triangle.getAttribute('aria-label');
		await dragTriangle(page, { x: 0.67, y: 0.43 });
		await expect(field).toHaveAttribute('data-camera-moving', 'false');
		await expect(field).toHaveAttribute('data-pick-ready', 'true', { timeout: 5_000 });
		await expect(triangle).not.toHaveAttribute('aria-label', before ?? '');
		const afterDrag = await triangle.getAttribute('aria-label');
		const shares = [...(afterDrag?.matchAll(/(\d+)%/g) ?? [])].map((match) => Number(match[1]));
		expect(shares).toHaveLength(3);
		expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100);

		await page
			.getByTestId('prominence-field')
			.getByRole('button', { name: 'Reset view', exact: true })
			.click();
		await expect(triangle).toHaveAttribute('aria-label', balancedLabel ?? '');
		await expect(page).toHaveURL(/lens=Balanced/);

		await triangle.focus();
		const keyboardBefore = await triangle.getAttribute('aria-label');
		await page.keyboard.press('ArrowUp');
		const keyboardAfter = await triangle.getAttribute('aria-label');
		expect(keyboardAfter).not.toBe(keyboardBefore);
		expect(keyboardAfter).toContain('Reader regard');
		await page.keyboard.press('Home');
		await expect(triangle).toHaveAttribute('aria-label', balancedLabel ?? '');
		await expect(page).toHaveURL(/lens=Balanced/);
	});

	test('ranking hover and selection share the map and inspector contract', async ({ page }) => {
		await openProminence(page);
		const firstRow = page.locator('.ranking-row__select').first();
		const name = (await firstRow.locator('strong').textContent())?.trim() ?? '';
		await firstRow.hover();
		await expect(page.locator('.prominence-field__hover')).toContainText(name);
		await firstRow.focus();
		await page.locator('.ranking-row__meta').first().click();

		const inspector = page.getByTestId('prominence-inspector');
		await expect(inspector).toBeVisible();
		await expect(page.getByRole('combobox', { name: 'Author search' })).toHaveValue('');
		await expect(inspector.getByTestId('prominence-contribution-bar')).toBeVisible();
		await expect(inspector).not.toContainText('Current composition');
		await expect(inspector).not.toContainText('Evidence observations');
		await expect(inspector).not.toContainText('Across the four lenses');
		await expect(inspector).not.toContainText('Audience concentration');

		await page.getByRole('button', { name: /Ranking/ }).click();
		await expect(page.getByTestId('prominence-ranking-panel')).toBeVisible();
		await expect(firstRow).toBeFocused();
	});

	test('the shared contribution control reveals values only on demand', async ({ page }) => {
		await openProminence(page);
		await page.locator('.ranking-row__select').first().click();
		const bar = page.getByTestId('prominence-contribution-bar');
		await expect(bar).toHaveAttribute('aria-label', /Reader regard/);
		await expect(bar).toHaveAttribute('aria-label', /Audience reach/);
		await expect(bar).toHaveAttribute('aria-label', /Critical recognition/);
		await expect(page.locator('.prominence-contribution__popover--all')).toHaveCount(0);
		await bar.hover();
		await expect(page.locator('.prominence-contribution__popover--all')).toBeVisible();
		await expect(page.locator('.prominence-contribution__value')).toHaveCount(3);
		await bar.focus();
		await expect(page.locator('.prominence-contribution__popover--all')).toBeVisible();
		await expect(page.locator('.prominence-contribution__value')).toHaveCount(3);
		await bar.press('Escape');
		await expect(page.locator('.prominence-contribution__popover--all')).toHaveCount(0);
	});

	test('map selection opens the same inspector', async ({ page }) => {
		await openProminence(page);
		await selectLeaderFromMap(page);
		await expect(page.getByTestId('prominence-inspector')).toBeVisible();
		await expect(page.getByRole('button', { name: /Ranking/ })).toBeVisible();
	});

	test('loads one lazy shard, renders Milne enrichment, and applies the stored best mix', async ({
		page
	}) => {
		const detailRequests: string[] = [];
		const supabaseBookRequests: string[] = [];
		page.on('request', (request) => {
			const url = request.url();
			if (/\/details\/\d+\.json/.test(url)) detailRequests.push(url);
			if (/\/rest\/v1\/books(?:[?#]|$)/i.test(url)) supabaseBookRequests.push(url);
		});
		await openProminence(page);
		expect(detailRequests).toHaveLength(0);

		await selectAuthorBySearch(page, 'A.A. Milne');
		const inspector = page.getByTestId('prominence-inspector');
		await expect(inspector.getByTestId('prominence-peak')).toBeVisible({ timeout: 10_000 });
		await expect(inspector.getByTestId('prominence-peak')).toContainText('#73');
		await expect(inspector.getByTestId('prominence-peak')).toContainText('60%');
		await expect(inspector.getByTestId('prominence-peak')).toContainText('40%');
		await expect(inspector.getByTestId('prominence-peak')).toContainText('0%');
		await expect(inspector.getByTestId('prominence-recognitions')).toContainText('Winner');
		await expect(inspector.getByTestId('prominence-catalogue')).toContainText('1922–1926');
		await expect.poll(() => detailRequests.length).toBe(1);
		expect(supabaseBookRequests).toHaveLength(0);

		await inspector.getByRole('button', { name: 'Point There', exact: true }).click();
		await expect(
			inspector.getByRole('button', { name: 'Best mix active', exact: true })
		).toBeVisible();
		const url = new URL(page.url());
		expect(url.searchParams.get('author')).toBe('v3:A.A. Milne');
		expect(url.searchParams.get('w')).toBe('0.600000000000,0.400000000000,0.000000000000');
	});

	test('does not fetch a second shard when two selected authors share one shard', async ({
		page
	}) => {
		const detailRequests: string[] = [];
		page.on('request', (request) => {
			if (/\/details\/\d+\.json/.test(request.url())) detailRequests.push(request.url());
		});
		await openProminence(page);
		await selectAuthorBySearch(page, 'A.A. Milne');
		await expect(page.getByTestId('prominence-peak')).toBeVisible({ timeout: 10_000 });
		await page.getByRole('button', { name: /Ranking/ }).click();
		await selectAuthorBySearch(page, '50 Cent');
		await expect(page.getByTestId('prominence-peak')).toBeVisible({ timeout: 10_000 });
		expect(new Set(detailRequests.map((url) => url.match(/details\/\d+\.json/)?.[0])).size).toBe(1);
		expect(detailRequests).toHaveLength(1);
	});

	test('ignores stale detail responses after rapid cross-shard selection', async ({ page }) => {
		await page.route('**/versions/*/web/details/0.json', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 500));
			await route.continue();
		});
		await openProminence(page);
		await selectAuthorBySearch(page, 'A.A. Milne');
		await selectAuthorBySearch(page, 'Stephen King');
		const inspector = page.getByTestId('prominence-inspector');
		await expect(inspector.locator('#inspector-heading')).toHaveText('Stephen King');
		await expect(inspector.getByTestId('prominence-peak')).toBeVisible({ timeout: 10_000 });
		await page.waitForTimeout(650);
		await expect(inspector.locator('#inspector-heading')).toHaveText('Stephen King');
	});

	test('keeps the base inspector usable when a shard fails and Retry refetches it', async ({
		page
	}) => {
		let attempts = 0;
		await page.route('**/versions/*/web/details/0.json', async (route) => {
			attempts += 1;
			if (attempts === 1) {
				await route.fulfill({ status: 503, body: 'unavailable' });
			} else {
				await route.continue();
			}
		});
		await openProminence(page);
		await selectAuthorBySearch(page, 'A.A. Milne');
		const inspector = page.getByTestId('prominence-inspector');
		await expect(inspector).toContainText('Author details unavailable');
		await expect(inspector.locator('#inspector-heading')).toHaveText('A.A. Milne');
		await inspector.getByRole('button', { name: 'Retry', exact: true }).click();
		await expect(inspector.getByTestId('prominence-peak')).toBeVisible({ timeout: 10_000 });
		expect(attempts).toBe(2);
	});

	test('similar-profile navigation preserves the lens and Browser Back restores the author', async ({
		page
	}) => {
		await openProminence(page);
		await selectAuthorBySearch(page, 'A.A. Milne');
		const inspector = page.getByTestId('prominence-inspector');
		const similarSection = inspector.getByTestId('prominence-similar');
		await expect(similarSection).toBeVisible({ timeout: 10_000 });
		const similarRows = similarSection.locator('button');
		const rowTops = await similarRows.evaluateAll((buttons) =>
			buttons.map((button) => Math.round(button.getBoundingClientRect().top))
		);
		expect(new Set(rowTops).size).toBe(1);
		const similar = similarRows.first();
		const name = (await similar.locator('strong').textContent())?.trim() ?? '';
		await similar.click();
		await expect(inspector.locator('#inspector-heading')).not.toHaveText('A.A. Milne');
		await expect(inspector.locator('#inspector-heading')).toHaveText(name);
		expect(new URL(page.url()).searchParams.get('lens')).toBe('Balanced');
		await page.goBack();
		await expect(inspector.locator('#inspector-heading')).toHaveText('A.A. Milne');
		await expect(inspector.getByTestId('prominence-peak')).toBeVisible({ timeout: 10_000 });
	});
});

test.describe('author prominence mobile workbench', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('uses one map-first lens sheet and keeps the rail in normal flow', async ({ page }) => {
		await openProminence(page);
		await expect(page.locator('.prominence-map-lens')).toHaveCount(0);
		await expect(page.locator('.mobile-lens-summary')).toBeVisible();
		await expect(page.locator('.prominence-rail [role="tab"]')).toHaveCount(0);
		await expect(page.getByRole('combobox', { name: 'Author search' })).toBeVisible();
		await expect(page.getByTestId('prominence-ranking-row')).toHaveCount(15);

		await page.locator('.mobile-lens-summary').click();
		const sheet = page.locator('.mobile-lens-sheet');
		await expect(sheet).toBeVisible();
		await expect(sheet.locator('.prominence-lens-control__triangle')).toHaveCount(1);
		await expect(sheet.getByRole('button', { name: 'Balanced', exact: true })).toHaveCount(0);
		await expect(sheet.locator('.prominence-lens-control__triangle')).toBeFocused();

		await sheet.locator('.prominence-lens-control__triangle').press('Escape');
		await expect(sheet).toBeHidden();
		await expect(page.locator('.mobile-lens-summary')).toBeFocused();
		await page.locator('.mobile-lens-summary').click();
		await expect(sheet.locator('.prominence-lens-control__triangle')).toBeFocused();
		await sheet.getByRole('button', { name: 'Close lens control' }).click();
		await expect(sheet).toBeHidden();
		await expect(page.locator('.mobile-lens-summary')).toBeFocused();
	});

	test('map selection scrolls to the inspector and back returns to the ranking', async ({
		page
	}) => {
		await openProminence(page);
		await selectLeaderFromMap(page);
		const inspector = page.getByTestId('prominence-inspector');
		await expect(inspector).toBeVisible();
		await expect(inspector).toBeInViewport();
		await expect(page.getByRole('combobox', { name: 'Author search' })).toBeVisible();
		await inspector.getByRole('button', { name: /Ranking/ }).click();
		await expect(page.getByTestId('prominence-ranking-panel')).toBeVisible();
		await expect(page.getByTestId('prominence-ranking-row')).toHaveCount(15);
	});
});
