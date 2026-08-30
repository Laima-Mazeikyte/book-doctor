import { describe, expect, it } from 'vitest';
import { PUBLIC_PRESET_NAME } from './contract';
import { ProminenceFormatError, type ProminenceManifest } from './types';
import { resolveProminenceArtifactBase, validateDetailManifest, validateManifest } from './release';

function fixture(): ProminenceManifest {
	return {
		schema_version: 2,
		generated_utc: '2026-08-29T17:05:26Z',
		version: 'test-v3',
		display: { top_n: 15 },
		model: {
			features: ['regard', 'reach', 'recognition'],
			feature_labels: {
				regard: 'Reader regard',
				reach: 'Audience reach',
				recognition: 'Critical recognition'
			},
			feature_blurbs: {
				regard: 'Reader regard description.',
				reach: 'Audience reach description.',
				recognition: 'Critical recognition description.'
			},
			sigma_z: [
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			default_weights: [0.35, 0.35, 0.3],
			index_base: 1500,
			index_scale: 173.71779276130076,
			index_is_calibrated_elo: false,
			mode: 'prominence',
			tier_weights: [100, 40, 15, 6, 2],
			gate: { min_books: 2 }
		},
		details: {
			schema_version: 1,
			author_count: 11950,
			shard_size: 128,
			shard_count: 94,
			index_base: 0,
			path_pattern: 'details/{shard}.json',
			book_limit: 4,
			recognition_record_limit: 5,
			peak_method: 'grid_1pct',
			peak_weight_quantum: 0.01,
			generated_utc: '2026-08-29T17:05:26Z'
		},
		presets: [
			{
				name: PUBLIC_PRESET_NAME,
				weights: [0.35, 0.35, 0.3],
				settled: true,
				note: 'The tested default.'
			},
			{
				name: 'Reader favourites',
				weights: [0.7, 0.15, 0.15],
				settled: false,
				note: 'A non-default test preset.'
			}
		],
		audit: {
			regard_only: {
				badge: 'Reader enthusiasm only',
				explain:
					'High ratings from readers who sought this author out, with no awards to corroborate them. Raise the reader regard slider and more authors like this appear.',
				rule: { min_regard_z: 1.5 }
			},
			reach_only: {
				badge: 'Ranked on readership',
				explain:
					'Below-median ratings and little recognition; readership is supplying most of the score.',
				rule: {
					max_regard_z: 0,
					min_reach_z: 1,
					max_recognition_z: 0,
					min_reach_share: 0.6
				}
			}
		},
		disclosure: {
			headline: 'This ranks prominence, not merit.',
			items: ['First disclosure.', 'Second disclosure.']
		},
		quality: {
			eligible_authors: 11950,
			authors_in_source: 34397,
			folds: 10,
			weights_settled_by: 'test fixture'
		}
	};
}

describe('v3 author-prominence release contract', () => {
	it('requires an explicitly configured Supabase artifact base', () => {
		expect(() => resolveProminenceArtifactBase(undefined)).toThrow(
			/PUBLIC_AUTHOR_PROMINENCE_BASE is required/
		);
		expect(() => resolveProminenceArtifactBase('   ')).toThrow(
			/PUBLIC_AUTHOR_PROMINENCE_BASE is required/
		);
		expect(resolveProminenceArtifactBase(' https://storage.example/author-prominence/ ')).toBe(
			'https://storage.example/author-prominence'
		);
	});

	it('accepts a complete schema-2 release manifest', () => {
		expect(() => validateManifest(fixture())).not.toThrow();
	});

	it('requires the v3 lazy-detail contract and matches the population count', () => {
		const manifest = fixture();
		expect(manifest.details.schema_version).toBe(1);
		expect(manifest.details.author_count).toBe(11950);
		expect(manifest.details.shard_count).toBe(94);
		expect(() => validateManifest(manifest, 11950)).not.toThrow();
		expect(() => validateManifest(manifest, 11949)).toThrow(/authors.json contains 11949/);
		const missing = { ...manifest, details: undefined } as unknown as ProminenceManifest;
		expect(() => validateManifest(missing)).toThrow(/detail configuration/);
	});

	it('rejects unsafe paths and invalid shard configuration', () => {
		const manifest = fixture();
		const invalidPaths = [
			'../{shard}.json',
			'/details/{shard}.json',
			'details/{shard}/{shard}.json',
			'details/%2e%2e/{shard}.json'
		];
		for (const path_pattern of invalidPaths) {
			const candidate = { ...manifest, details: { ...manifest.details, path_pattern } };
			expect(() => validateDetailManifest(candidate.details)).toThrow(/path_pattern/);
		}
		const invalidSize = { ...manifest.details, shard_size: 0 };
		expect(() => validateDetailManifest(invalidSize)).toThrow(/shard_size/);
		const invalidCount = { ...manifest.details, shard_count: 1 };
		expect(() => validateDetailManifest(invalidCount)).toThrow(/shard_count/);
	});

	it('ships the approved audit copy', () => {
		const manifest = fixture();
		expect(manifest.audit.regard_only.badge).toBe('Reader enthusiasm only');
		expect(manifest.audit.regard_only.explain).toBe(
			'High ratings from readers who sought this author out, with no awards to corroborate them. Raise the reader regard slider and more authors like this appear.'
		);
		expect(manifest.audit.reach_only.badge).toBe('Ranked on readership');
		expect(manifest.audit.reach_only.explain).toBe(
			'Below-median ratings and little recognition; readership is supplying most of the score.'
		);
	});

	it('rejects the retired schema-1 release', () => {
		const manifest = fixture();
		manifest.schema_version = 1;
		expect(() => validateManifest(manifest)).toThrow(/Unsupported manifest schema_version 1/);
	});

	it('rejects the retired clean-like threshold', () => {
		const manifest = fixture();
		(manifest.model.gate as Record<string, unknown>).min_clean_likes = 94;
		expect(() => validateManifest(manifest)).toThrow(/must not contain min_clean_likes/);
	});

	it('accepts omitted optional provenance fields', () => {
		const manifest = fixture();
		delete manifest.model.tier_weights;
		delete manifest.model.gate;
		delete manifest.quality.folds;
		expect(() => validateManifest(manifest)).not.toThrow();
	});

	it('rejects swapped or duplicated feature axes', () => {
		const manifest = fixture();
		manifest.model.features = ['regard', 'regard', 'recognition'];
		expect(() => validateManifest(manifest)).toThrow(ProminenceFormatError);
		const reordered = fixture();
		reordered.model.features = ['recognition', 'regard', 'reach'];
		expect(() => validateManifest(reordered)).not.toThrow();
	});

	it('rejects non-finite or asymmetric covariance', () => {
		const manifest = fixture();
		manifest.model.sigma_z[0][1] = Number.NaN;
		expect(() => validateManifest(manifest)).toThrow(/finite/);
		const asymmetric = fixture();
		asymmetric.model.sigma_z[0][1] = 0.4;
		expect(() => validateManifest(asymmetric)).toThrow(/symmetric/);
	});

	it('requires a positive-definite correlation matrix', () => {
		const indefinite = fixture();
		indefinite.model.sigma_z = [
			[1, -0.6, -0.6],
			[-0.6, 1, -0.6],
			[-0.6, -0.6, 1]
		];
		expect(() => validateManifest(indefinite)).toThrow(/positive-definite/);

		const singular = fixture();
		singular.model.sigma_z = [
			[1, 1, 0],
			[1, 1, 0],
			[0, 0, 1]
		];
		expect(() => validateManifest(singular)).toThrow(/positive-definite/);
	});

	it('enforces correlation diagonals and off-diagonal bounds', () => {
		const diagonal = fixture();
		diagonal.model.sigma_z[0][0] = 1.0001;
		expect(() => validateManifest(diagonal)).toThrow(/diagonal/);

		const outOfRange = fixture();
		outOfRange.model.sigma_z[0][1] = 1.1;
		outOfRange.model.sigma_z[1][0] = 1.1;
		expect(() => validateManifest(outOfRange)).toThrow(/\[-1, 1\]/);
	});

	it('accepts generated floating-point boundary noise', () => {
		const manifest = fixture();
		manifest.model.sigma_z[0][0] = 1 + 5e-9;
		manifest.model.sigma_z[1][1] = 1 - 5e-9;
		expect(() => validateManifest(manifest)).not.toThrow();
	});

	it('rejects a valid matrix when a default or preset has unusable raw variance', () => {
		const manifest = fixture();
		const delta = 1e-13;
		manifest.model.sigma_z = [
			[1, -1 + delta, 0],
			[-1 + delta, 1, 0],
			[0, 0, 1]
		];
		manifest.model.default_weights = [0.5, 0.5, 0];
		manifest.presets[0].weights = [0.5, 0.5, 0];
		expect(() => validateManifest(manifest)).toThrow(/raw variance/);
	});

	it('requires exactly one tested default and normalized nonnegative weights', () => {
		const manifest = fixture();
		manifest.presets[1].settled = true;
		expect(() => validateManifest(manifest)).toThrow(/exactly one/);
		const invalid = fixture();
		invalid.model.default_weights = [2, 0, 0];
		expect(() => validateManifest(invalid)).toThrow(/sum to 1/);
	});

	it('requires the tested default preset to use the public contract name', () => {
		const manifest = fixture();
		manifest.presets[0].name = 'Default';
		expect(() => validateManifest(manifest)).toThrow(
			new RegExp(`must be named "${PUBLIC_PRESET_NAME}"`)
		);
	});
});
