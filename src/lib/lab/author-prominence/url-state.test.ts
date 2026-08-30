import { describe, expect, it } from 'vitest';
import { PUBLIC_PRESET_NAME } from './contract';
import { parseProminenceUrl, serializeProminenceUrl } from './url-state';
import type { Population, ProminenceManifest } from './types';

const manifest: ProminenceManifest = {
	schema_version: 2,
	generated_utc: '2026-01-01T00:00:00Z',
	version: 'v3',
	display: { top_n: 2 },
	details: {
		schema_version: 1,
		author_count: 2,
		shard_size: 2,
		shard_count: 1,
		index_base: 0,
		path_pattern: 'details/{shard}.json',
		book_limit: 4,
		recognition_record_limit: 5,
		peak_method: 'grid_1pct',
		peak_weight_quantum: 0.01,
		generated_utc: '2026-01-01T00:00:00Z'
	},
	model: {
		features: ['regard', 'reach', 'recognition'],
		feature_labels: { regard: 'Regard', reach: 'Reach', recognition: 'Recognition' },
		feature_blurbs: { regard: 'r', reach: 'h', recognition: 'c' },
		sigma_z: [
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1]
		],
		default_weights: [0.5, 0.3, 0.2],
		index_base: 0,
		index_scale: 1,
		index_is_calibrated_elo: false,
		mode: 'prominence',
		tier_weights: [1],
		gate: { min_books: 1 }
	},
	presets: [
		{ name: PUBLIC_PRESET_NAME, weights: [0.5, 0.3, 0.2], settled: true, note: 'tested' },
		{ name: 'Reach', weights: [0.1, 0.8, 0.1], settled: false, note: 'reach' }
	],
	audit: {
		regard_only: { badge: 'r', explain: 'r', rule: { min_regard_z: 1 } },
		reach_only: {
			badge: 'h',
			explain: 'h',
			rule: { max_regard_z: 0, min_reach_z: 1, max_recognition_z: 0, min_reach_share: 0.5 }
		}
	},
	disclosure: { headline: 'headline', items: ['item'] },
	quality: { eligible_authors: 2, authors_in_source: 2, folds: 1, weights_settled_by: 'test' }
};

const population: Population = {
	count: 2,
	names: ['Ada Lovelace', 'Grace Hopper'],
	authorIds: ['a1', 'g1'],
	z: [Float64Array.from([0, 0]), Float64Array.from([0, 0]), Float64Array.from([0, 0])],
	hasRecognition: Uint8Array.from([0, 0]),
	nBooks: new Int32Array(2),
	bestTier: new Int8Array(2),
	nAwards: new Int32Array(2),
	concentration: new Float64Array(2)
};

describe('prominence URL state', () => {
	it('starts bare URLs from the tested default', () => {
		expect(parseProminenceUrl('', manifest, population).lens.displayName).toBe(PUBLIC_PRESET_NAME);
	});

	it(`accepts ${PUBLIC_PRESET_NAME} and ignores a conflicting custom vector`, () => {
		const state = parseProminenceUrl(`?lens=${PUBLIC_PRESET_NAME}&w=1,0,0`, manifest, population);
		expect(state.lens.displayName).toBe(PUBLIC_PRESET_NAME);
		expect(state.lens.weights).toEqual([0.5, 0.3, 0.2]);
	});

	it('rejects retired or unknown named presets and malformed custom weights', () => {
		const retired = parseProminenceUrl('?lens=Reach&w=0.1,0.8,0.1', manifest, population);
		expect(retired.lens.displayName).toBe(PUBLIC_PRESET_NAME);
		expect(retired.invalidLens).toBe(true);
		const unknown = parseProminenceUrl('?lens=Unknown', manifest, population);
		expect(unknown.lens.displayName).toBe(PUBLIC_PRESET_NAME);
		expect(unknown.invalidLens).toBe(true);
		expect(parseProminenceUrl('?w=2,0,0', manifest, population).lens.displayName).toBe(
			PUBLIC_PRESET_NAME
		);
	});

	it('keeps retired preset weights supplied through w as a custom lens', () => {
		const parsed = parseProminenceUrl('?w=0.1,0.8,0.1', manifest, population);
		expect(parsed.lens.displayName).toBe('Custom');
		const href = serializeProminenceUrl(
			'/lab/author-prominence',
			'/lab/author-prominence',
			parsed,
			manifest,
			population
		);
		expect(href).toBe('/lab/author-prominence?w=0.100000000000%2C0.800000000000%2C0.100000000000');
	});

	it('rejects an otherwise normalized custom lens with unsafe raw variance', () => {
		const delta = 1e-13;
		const unsafeSigma = [
			[1, -1 + delta, 0],
			[-1 + delta, 1, 0],
			[0, 0, 1]
		];
		const state = parseProminenceUrl('?w=0.5,0.5,0', manifest, population, unsafeSigma);
		expect(state.lens.displayName).toBe(PUBLIC_PRESET_NAME);
		expect(state.invalidLens).toBe(true);
	});

	it('restores version-qualified stable author IDs and serializes round trips', () => {
		const parsed = parseProminenceUrl(
			`?lens=${PUBLIC_PRESET_NAME}&author=v3:g1`,
			manifest,
			population
		);
		expect(parsed.selectedIndex).toBe(1);
		const href = serializeProminenceUrl(
			'/lab/author-prominence',
			'/lab/author-prominence',
			parsed,
			manifest,
			population
		);
		expect(href).toBe(`/lab/author-prominence?lens=${PUBLIC_PRESET_NAME}&author=v3%3Ag1`);
		expect(
			parseProminenceUrl(new URL(`http://local${href}`).search, manifest, population).selectedIndex
		).toBe(1);
	});
});
