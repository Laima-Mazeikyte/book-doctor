import { describe, expect, it } from 'vitest';
import { parseProminenceUrl, serializeProminenceUrl } from './url-state';
import type { Population, ProminenceManifest } from './types';

const manifest: ProminenceManifest = {
	schema_version: 1,
	generated_utc: '2026-01-01T00:00:00Z',
	version: 'v1',
	display: { top_n: 2 },
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
		gate: { min_books: 1, min_clean_likes: 1 }
	},
	presets: [
		{ name: 'Balanced', weights: [0.5, 0.3, 0.2], settled: true, note: 'tested' },
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
	nReaders: new Int32Array(2),
	bestTier: new Int8Array(2),
	nAwards: new Int32Array(2),
	concentration: new Float64Array(2)
};

describe('prominence URL state', () => {
	it('starts bare URLs from the tested default', () => {
		expect(parseProminenceUrl('', manifest, population).lens.displayName).toBe('Balanced');
	});

	it('gives a valid preset precedence over a conflicting custom vector', () => {
		const state = parseProminenceUrl('?lens=Reach&w=1,0,0', manifest, population);
		expect(state.lens.displayName).toBe('Reach');
	});

	it('fails safely for an unknown preset or malformed custom weights', () => {
		expect(
			parseProminenceUrl('?lens=Unknown&w=0.1,0.8,0.1', manifest, population).lens.displayName
		).toBe('Balanced');
		expect(parseProminenceUrl('?w=2,0,0', manifest, population).lens.displayName).toBe('Balanced');
	});

	it('rejects an otherwise normalized custom lens with unsafe raw variance', () => {
		const delta = 1e-13;
		const unsafeSigma = [
			[1, -1 + delta, 0],
			[-1 + delta, 1, 0],
			[0, 0, 1]
		];
		const state = parseProminenceUrl('?w=0.5,0.5,0', manifest, population, unsafeSigma);
		expect(state.lens.displayName).toBe('Balanced');
		expect(state.invalidLens).toBe(true);
	});

	it('restores version-qualified stable author IDs and serializes round trips', () => {
		const parsed = parseProminenceUrl('?lens=Reach&author=v1:g1', manifest, population);
		expect(parsed.selectedIndex).toBe(1);
		const href = serializeProminenceUrl(
			'/lab/author-prominence',
			'/lab/author-prominence',
			parsed,
			manifest,
			population
		);
		expect(href).toBe('/lab/author-prominence?lens=Reach&author=v1%3Ag1');
		expect(
			parseProminenceUrl(new URL(`http://local${href}`).search, manifest, population).selectedIndex
		).toBe(1);
	});
});
