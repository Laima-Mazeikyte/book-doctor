import { expect, test } from '@playwright/test';

const covariance = [
	[1, 0, 0],
	[0, 1, 0],
	[0, 0, 1]
];
const manifest = {
	schema_version: 2,
	version: 'test',
	generated_utc: '2026-09-19',
	display: { top_n: 4 },
	datasets: {
		best_items: 'rankings/best_items.json',
		polarizing_items: 'rankings/polarizing_items.json'
	},
	model: {
		best_items: {
			features: ['regard', 'reach', 'recognition'],
			sigma_z: covariance,
			default_weights: [0.4, 0.3, 0.3]
		},
		polarizing_items: {
			features: ['disagreement', 'balance', 'intensity'],
			sigma_z: covariance,
			default_weights: [0.4, 0.4, 0.2],
			default_reach_share: 0.3
		}
	},
	presets: {
		best_items: [
			{ name: 'Configured default', weights: [0.4, 0.3, 0.3] },
			{ name: 'Reader regard', weights: [0.7, 0.15, 0.15] },
			{ name: 'Most read', weights: [0.2, 0.6, 0.2] },
			{ name: 'Most recognised', weights: [0.2, 0.2, 0.6] }
		],
		polarizing_items: [
			{ name: 'Pure statistical polarization', weights: [0.4, 0.4, 0.2], reach_share: 0 },
			{ name: 'Cultural polarization', weights: [0.4, 0.4, 0.2], reach_share: 0.3 },
			{ name: 'Broad cultural controversy', weights: [0.4, 0.4, 0.2], reach_share: 0.45 }
		]
	},
	disclosure: { headline: '', items: [] },
	quality: { items: { best_items: 4, polarizing_items: 4 } }
};

/** The catalog rows the details window reads for genres, year and description. */
const catalogRows: Record<string, Record<string, unknown>> = {
	'01AAAAAAAAAAAAAAAAAAAAAAAA': {
		id: 'uuid-first',
		book_id: '01AAAAAAAAAAAAAAAAAAAAAAAA',
		book_name: 'First Book',
		author: 'First Author',
		summary: 'A first description.',
		year: 1971,
		genre1: 'Fantasy',
		genre2: 'Adventure',
		genre3: 'Classics',
		genre4: 'Mythology',
		genre5: 'Epic',
		type: 'novel'
	},
	'01CCCCCCCCCCCCCCCCCCCCCCCC': {
		id: 'uuid-volume-one',
		book_id: '01CCCCCCCCCCCCCCCCCCCCCCCC',
		book_name: 'Third Series, Volume One',
		author: 'Third Author',
		summary: 'The opening volume.',
		year: 1996,
		genre1: 'Fantasy',
		type: 'novel'
	},
	'01DDDDDDDDDDDDDDDDDDDDDDDD': {
		id: 'uuid-volume-two',
		book_id: '01DDDDDDDDDDDDDDDDDDDDDDDD',
		book_name: 'Third Series, Volume Two',
		author: 'Third Author',
		summary: 'The second volume.',
		year: 1999,
		genre1: 'Fantasy',
		type: 'novel'
	}
};

test.beforeEach(async ({ page }) => {
	await page.route('**/rest/v1/books*', (route) => {
		const ulids = decodeURIComponent(route.request().url()).match(/01[0-9A-HJKMNP-TV-Z]{24}/gi);
		const rows = [...new Set(ulids ?? [])]
			.map((ulid) => catalogRows[ulid.toUpperCase()])
			.filter(Boolean);
		return route.fulfill({ json: rows });
	});
	await page.route('**/current_release.json', (route) =>
		route.fulfill({ json: { version: 'test' } })
	);
	await page.route('**/versions/test/web/manifest.json', (route) =>
		route.fulfill({ json: manifest })
	);
	await page.route('**/versions/test/web/rankings/*.json', (route) => {
		const polarizing = route.request().url().includes('polarizing_items');
		const features = polarizing
			? ['disagreement_z', 'balance_z', 'intensity_z']
			: ['regard_z', 'reach_z', 'recognition_z'];
		return route.fulfill({
			json: {
				columns: [
					'item_id',
					'item_type',
					'title',
					'author',
					'series_name',
					'constituent_book_ids',
					...features,
					'cultural_reach_z'
				],
				rows: [
					[
						'a',
						'book',
						'First Book',
						'First Author',
						null,
						['01AAAAAAAAAAAAAAAAAAAAAAAA'],
						3,
						1,
						2,
						1
					],
					[
						'b',
						'book',
						'Second Book',
						'Second Author',
						null,
						['01BBBBBBBBBBBBBBBBBBBBBBBB'],
						1,
						3,
						1,
						3
					],
					[
						'c',
						'series',
						'Third Series',
						'Third Author',
						'Third Series',
						['01CCCCCCCCCCCCCCCCCCCCCCCC', '01DDDDDDDDDDDDDDDDDDDDDDDD'],
						1,
						0,
						0,
						0
					],
					[
						'd',
						'book',
						'Fourth Book',
						'Fourth Author',
						null,
						['01EEEEEEEEEEEEEEEEEEEEEEEE'],
						-1,
						-1,
						-1,
						-1
					]
				]
			}
		});
	});
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto('http://127.0.0.1:4173/lab/book-search', { waitUntil: 'domcontentloaded' });
	await expect(page.locator('.book-search-board__row')).toHaveCount(4);
});

for (const mode of ['Best Books', 'Most Polarizing Books']) {
	test(`${mode}: context dismissal consumes the click and the details window closes`, async ({
		page
	}) => {
		if (mode !== 'Best Books') await page.getByRole('tab', { name: mode, exact: true }).click();
		const rows = page.locator('.book-search-board__row');
		await rows.first().click();
		const context = page.getByRole('dialog', { name: /Ranking details/ });
		await expect(context).toBeVisible();
		await expect(context.getByRole('region', { name: 'Ranking dimensions' })).toContainText(
			'Top 25.0%'
		);
		if (mode !== 'Best Books')
			await expect(context.getByRole('heading', { name: 'Popularity' })).toBeVisible();
		// Click the rank cell of another row, outside the centered dialog.
		const box = await rows.nth(1).boundingBox();
		await page.mouse.click(box!.x + 10, box!.y + box!.height / 2);
		await expect(context).toHaveCount(0);
		await expect(page.locator('.book-search-board__row[aria-expanded="true"]')).toHaveCount(0);
		await rows.first().focus();
		await page.keyboard.press('Enter');
		await expect(context).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(context).toHaveCount(0);
		await expect(rows.first()).toBeFocused();
	});
}

test('the details window carries the catalog entry, capped at four genres', async ({ page }) => {
	await page.getByRole('button', { name: /Show ranking details for First Book/ }).click();
	const context = page.getByRole('dialog', { name: 'Ranking details for First Book' });
	await expect(context.locator('.book-search-about__summary')).toHaveText('A first description.');
	await expect(context.locator('.book-search-about__facts')).toHaveText(
		'1971 · Fantasy · Adventure · Classics · Mythology'
	);
	await expect(context.locator('.book-search-about__volume')).toHaveCount(0);
});

test('presets change the ranking and feature help works on keyboard focus', async ({ page }) => {
	await expect(page.locator('.book-search-presets button')).toHaveCount(4);
	await page.getByRole('button', { name: 'Most read', exact: true }).click();
	await expect(page.locator('.book-search-board__row').first()).toContainText('Second Book');
	await expect(page.getByRole('button', { name: 'Most read', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: 'About Average rating', exact: true }).focus();
	await expect(page.getByRole('tooltip', { name: /How highly readers rate/ })).toBeVisible();
	await page.getByRole('button', { name: 'How it works', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'How the ranking is made' })).toBeVisible();
	await expect(page.locator('.book-search-methodology')).not.toContainText('Release');
});

test('How it works consumes outside clicks and restores focus on dismissal', async ({ page }) => {
	const trigger = page.getByRole('button', { name: 'How it works', exact: true });
	const dialog = page.getByRole('dialog', { name: 'How the ranking is made' });
	for (const mode of ['Best Books', 'Most Polarizing Books']) {
		await page.getByRole('tab', { name: mode, exact: true }).click();
		await trigger.click();
		await expect(dialog).toBeVisible();
		const row = await page.locator('.book-search-board__row').first().boundingBox();
		await page.mouse.click(row!.x + 10, row!.y + row!.height / 2);
		await expect(dialog).toHaveCount(0);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.locator('.book-search-board__row[aria-expanded="true"]')).toHaveCount(0);
		await expect(trigger).toBeFocused();
		await trigger.click();
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(trigger).toBeFocused();
		await trigger.click();
		await dialog.getByRole('button', { name: 'Close how it works' }).click();
		await expect(dialog).toHaveCount(0);
		await expect(trigger).toBeFocused();
	}
});

test('mobile presets and series covers remain usable', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.locator('.book-search-settings-trigger').click();
	await page.getByRole('button', { name: 'Most read', exact: true }).click();
	await page.getByRole('button', { name: 'Close ranking settings', exact: true }).click();
	await page.getByRole('button', { name: /Show ranking details for Third Series/ }).click();
	const context = page.getByRole('dialog', { name: 'Ranking details for Third Series' });
	await expect(context).toBeVisible();
	const fits = await context.evaluate((el) => el.scrollWidth <= el.clientWidth);
	expect(fits).toBe(true);
	// The window opens on the first volume and swaps in place, without opening anything else.
	await expect(context.locator('.book-search-about__volume')).toHaveText(
		'Volume 1 · Third Series, Volume One'
	);
	await expect(context.locator('.book-search-about__summary')).toHaveText('The opening volume.');
	const secondVolume = context.getByRole('button', {
		name: 'Show volume 2 of Third Series'
	});
	await secondVolume.click();
	await expect(secondVolume).toHaveAttribute('aria-pressed', 'true');
	await expect(context.locator('.book-search-about__volume')).toHaveText(
		'Volume 2 · Third Series, Volume Two'
	);
	await expect(context.locator('.book-search-about__summary')).toHaveText('The second volume.');
	await expect(context.locator('.book-search-about__facts')).toHaveText('1999 · Fantasy');
	await expect(context).toBeVisible();
});

test('search keeps typing immediate, settles only the latest query, and clears pending work', async ({
	page
}) => {
	await page.clock.install();
	const input = page.getByRole('searchbox', { name: 'Search titles, authors, or series' });
	const board = page.getByRole('region', { name: 'Ranked titles' });
	const rows = page.locator('.book-search-board__row');
	await input.fill('First');
	await expect(input).toHaveValue('First');
	await expect(rows).toHaveCount(4);
	await expect(board).toHaveAttribute('aria-busy', 'true');
	await input.fill('Second');
	await page.clock.runFor(150);
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText('Second Book');
	await expect(rows.first()).toHaveAttribute('aria-label', /overall rank 2(,|$)/);
	await expect(board).toHaveAttribute('aria-busy', 'false');
	await input.fill('does not exist');
	await page.locator('.search-bar__clear').click();
	await expect(rows).toHaveCount(4);
	await page.clock.runFor(200);
	await expect(rows).toHaveCount(4);
	await expect(input).toHaveValue('');
	await input.fill('Second');
	await page.getByRole('tab', { name: 'Most Polarizing Books', exact: true }).click();
	await page.clock.runFor(150);
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText('Second Book');
	await expect(board).toHaveAttribute('aria-busy', 'false');
});

test('filtered results follow preset changes in the search worker', async ({ page }) => {
	await page.getByRole('searchbox').fill('Book');
	const rows = page.locator('.book-search-board__row');
	await expect(rows).toHaveCount(3);
	await expect(rows.first()).toContainText('First Book');
	await page.getByRole('button', { name: 'Most read', exact: true }).click();
	await expect(rows.first()).toContainText('Second Book');
	await expect(rows.first()).toHaveAttribute('aria-label', /overall rank 1(,|$)/);
});

test('search still works if a background worker cannot start', async ({ page }) => {
	await page.addInitScript(() => {
		window.Worker = class {
			constructor() {
				throw new Error('Worker unavailable');
			}
		} as unknown as typeof Worker;
	});
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.getByRole('searchbox').fill('Second');
	await expect(page.locator('.book-search-board__row')).toHaveCount(1);
	await expect(page.locator('.book-search-board__row')).toContainText('Second Book');
});

test('re-selecting the active tab keeps a custom weighting', async ({ page }) => {
	await expect(page.getByRole('button', { name: 'Default', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const regard = page.getByRole('slider', { name: 'Average rating' });
	await regard.focus();
	await page.keyboard.press('Home');
	await expect(regard).toHaveValue('0');
	await expect(page.locator('.book-search-preset[aria-pressed="true"]')).toHaveCount(0);
	await page.getByRole('tab', { name: 'Best Books', exact: true }).click();
	await expect(regard).toHaveValue('0');
	await expect(page.locator('.book-search-preset[aria-pressed="true"]')).toHaveCount(0);
});

test('presets show no notes and tooltips close with Escape', async ({ page }) => {
	await expect(
		page.getByRole('button', { name: 'Critically acclaimed', exact: true })
	).toBeVisible();
	await expect(
		page.locator('.book-search-preset[title], .book-search-preset[aria-describedby]')
	).toHaveCount(0);
	await expect(
		page.getByText('The starting point, with the three signals in balance.')
	).toHaveCount(0);
	await page.getByRole('button', { name: 'About Average rating', exact: true }).focus();
	const tooltip = page.getByRole('tooltip', { name: /How highly readers rate/ });
	await expect(tooltip).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(tooltip).toBeHidden();
});

test('the polarizing view opens with popularity counting as much as disagreement', async ({
	page
}) => {
	await page.getByRole('tab', { name: 'Most Polarizing Books', exact: true }).click();
	const popularity = page.getByRole('slider', { name: 'Popularity' });
	await expect(popularity).toHaveValue('50');
	// The shipped polarizing presets only move this slider, so the group is not offered here.
	await expect(page.locator('.book-search-preset')).toHaveCount(0);
	await popularity.focus();
	await page.keyboard.press('Home');
	await expect(popularity).toHaveValue('0');
	await expect(page.locator('.book-search-board__row').first()).toBeVisible();
	await page.getByRole('tab', { name: 'Best Books', exact: true }).click();
	await expect(page.locator('.book-search-preset')).toHaveCount(4);
});

test('rank movement stays until the next change and the score is explained in How it works', async ({
	page
}) => {
	await page.getByRole('button', { name: 'Most read', exact: true }).click();
	const moved = page.getByRole('button', { name: /Second Book.*moved up 1 place$/ });
	await expect(moved).toBeVisible();
	// The movement stays on the row until the next change, rather than fading on a timer.
	await page.waitForTimeout(4000);
	await expect(moved).toBeVisible();
	// Switching view clears it.
	await page.getByRole('tab', { name: 'Most Polarizing Books', exact: true }).click();
	await expect(page.locator('.book-search-board__movement')).toHaveCount(0);
	// The score is explained in How it works, not under the table.
	await expect(
		page.getByText('Higher means readers are more divided about the title.')
	).toHaveCount(0);
	await page.getByRole('button', { name: 'How it works', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'How the ranking is made' })).toContainText(
		'Higher means readers are more divided about the title.'
	);
});

test('mobile settings sheet is a modal dialog that restores focus', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const trigger = page.locator('.book-search-settings-trigger');
	await trigger.click();
	await expect(trigger).toContainText('Score weighting');
	await expect(trigger).toContainText('Default');
	const sheet = page.getByRole('dialog', { name: 'Ranking settings' });
	await expect(sheet).toBeVisible();
	// The sheet carries only the controls the desktop sidebar shows.
	await expect(sheet).not.toContainText('Tune the mix');
	await expect(sheet.getByRole('button', { name: 'Show results' })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await expect(trigger).toBeFocused();
});

test('an empty search shows one message, not a zero count as well', async ({ page }) => {
	await page.getByRole('searchbox').fill('does not exist');
	await expect(page.getByText('No matches')).toBeVisible();
	await expect(page.locator('.book-search-board__note')).toHaveCount(0);
});

test('switching volume is announced; opening the window is not', async ({ page }) => {
	await page.getByRole('button', { name: /Show ranking details for Third Series/ }).click();
	const context = page.getByRole('dialog', { name: 'Ranking details for Third Series' });
	const live = context.locator('[aria-live="polite"]');
	await expect(live).toHaveText('');
	await context.getByRole('button', { name: 'Show volume 2 of Third Series' }).click();
	await expect(live).toHaveText('Volume 2, Third Series, Volume Two');
	await expect(context.getByRole('heading', { level: 2, name: 'Third Series' })).toBeVisible();
});
