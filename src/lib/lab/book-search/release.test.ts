import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDataset, loadRelease } from './release';
import { BookRankingFormatError } from './types';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_BOOK_RANKINGS_BASE: '/handoff', PUBLIC_BOOK_RANKINGS_VERSION: 'v8' }
}));

const model = {
	features: ['regard', 'reach', 'recognition'],
	default_weights: [0.4, 0.3, 0.3],
	sigma_z: [
		[1, 0.1, 0.2],
		[0.1, 1, 0.3],
		[0.2, 0.3, 1]
	]
};
const manifest = {
	schema_version: 2,
	version: 'v9',
	display: { top_n: 25 },
	datasets: {
		best_items: 'rankings/best_items.json',
		polarizing_items: 'rankings/polarizing_items.json'
	},
	model: { best_items: model, polarizing_items: model },
	presets: {
		best_items: [{ name: 'Default', weights: model.default_weights }],
		polarizing_items: [{ name: 'Default', weights: model.default_weights }]
	},
	quality: { items: { best_items: 2, polarizing_items: 2 } }
};

function stubManifest(value: unknown) {
	vi.stubGlobal(
		'fetch',
		vi
			.fn()
			.mockResolvedValueOnce(Response.json({ version: 'v9' }))
			.mockResolvedValueOnce(Response.json(value))
	);
}

afterEach(() => vi.unstubAllGlobals());

describe('v9 book ranking release', () => {
	it('follows the current pointer despite a stale version pin and loads the unified dataset', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ web_root: 'versions/v9/web' }))
			.mockResolvedValueOnce(Response.json(manifest))
			.mockResolvedValueOnce(
				Response.json({
					columns: [
						'item_id',
						'item_type',
						'title',
						'author',
						'series_name',
						'constituent_book_ids',
						'regard_z',
						'reach_z',
						'recognition_z'
					],
					rows: [
						['work-a', 'book', 'A', 'Author', null, ['source-a', 'edition-a'], 1, 0, 0],
						['series-b', 'series', 'B', 'Author', 'B', ['volume-b1', 'volume-b2'], 0, 1, 0]
					]
				})
			);
		vi.stubGlobal('fetch', fetcher);
		const release = await loadRelease();
		expect(fetcher).toHaveBeenNthCalledWith(1, '/handoff/current_release.json', {
			cache: 'no-cache'
		});
		const population = await loadDataset(release, 'best_items');
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			'/handoff/current_release.json',
			'/handoff/versions/v9/web/manifest.json',
			'/handoff/versions/v9/web/rankings/best_items.json'
		]);
		expect(release.manifest.model.best_items).toEqual(model);
		expect(population.count).toBe(2);
		expect(population.itemTypes).toEqual(['book', 'series']);
		expect(population.constituentBookIds).toEqual([
			['source-a', 'edition-a'],
			['volume-b1', 'volume-b2']
		]);
	});

	it('rejects a legacy schema instead of using its scores', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(Response.json({ version: 'v8' }))
				.mockResolvedValueOnce(Response.json({ ...manifest, schema_version: 1 }))
		);
		await expect(loadRelease()).rejects.toThrow('Unsupported manifest schema_version 1');
	});

	it('reports a model without a feature list as a format error', async () => {
		stubManifest({
			...manifest,
			model: { ...manifest.model, best_items: { ...model, features: undefined } }
		});
		await expect(loadRelease()).rejects.toBeInstanceOf(BookRankingFormatError);
	});

	it('requires the item counts shown in the page footer', async () => {
		stubManifest({ ...manifest, quality: undefined });
		await expect(loadRelease()).rejects.toThrow('does not report the best_items item count');
	});
});
