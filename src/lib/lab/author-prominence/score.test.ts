import { describe, expect, it } from 'vitest';
import {
	auditBadges,
	buildPopulation,
	contributions,
	denominator,
	formatContribution,
	formatScore,
	placeOf,
	rank,
	rawVariance
} from './score';
import { ProminenceFormatError, ProminenceScoringError, type ProminenceManifest } from './types';

/**
 * Fixture values are lifted from the v3 release: the correlation matrix, the
 * settled weights, the audit thresholds, and the rows for the authors the build's own
 * `run_manifest.verified_top` names in positions 1–5.
 */

const COLUMNS = [
	'author',
	'regard_z',
	'reach_z',
	'recognition_z',
	'n_books',
	'best_tier',
	'n_awards',
	'concentration',
	'has_recognition'
];

const ROWS: unknown[][] = [
	['J.K. Rowling', 1.937895, 3.66119, 1.66801, 8, 2, 34, 0.0649, 1],
	['Percival Everett', 2.36579, 2.171751, 2.822178, 9, 1, 39, 0.1184, 1],
	['Margaret Atwood', 0.506791, 3.266758, 3.66119, 35, 1, 51, 0.0506, 1],
	['Angie Thomas', 2.668677, 2.296039, 2.24108, 3, 1, 38, 0.0956, 1],
	['Fredrik Backman', 1.888225, 3.076844, 2.131422, 10, 1, 16, 0.0689, 1]
];

const SIGMA_Z = [
	[0.9999999999999999, 0.06705977329923539, 0.23879411002538387],
	[0.0670597732992354, 1.0, 0.39342733034442134],
	[0.23879411002538387, 0.39342733034442134, 1.0]
];

function manifest(overrides: Partial<ProminenceManifest> = {}): ProminenceManifest {
	return {
		schema_version: 2,
		generated_utc: '2026-07-27T17:50:10Z',
		version: 'v3',
		display: { top_n: 10 },
		model: {
			features: ['regard', 'reach', 'recognition'],
			feature_labels: {
				regard: 'Reader regard',
				reach: 'Audience reach',
				recognition: 'Critical recognition'
			},
			feature_blurbs: { regard: '', reach: '', recognition: '' },
			sigma_z: SIGMA_Z,
			default_weights: [0.35, 0.35, 0.3],
			index_base: 1500,
			index_scale: 173.71779276130076,
			index_is_calibrated_elo: false,
			mode: 'prominence',
			tier_weights: [100, 40, 15, 6, 2],
			gate: { min_books: 2 },
			...overrides.model
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
			generated_utc: '2026-07-27T17:50:10Z'
		},
		presets: [{ name: 'Balanced', weights: [0.35, 0.35, 0.3], settled: true, note: '' }],
		audit: {
			regard_only: { badge: 'Reader enthusiasm only', explain: '', rule: { min_regard_z: 1.5 } },
			reach_only: {
				badge: 'Ranked on readership',
				explain: '',
				rule: {
					max_regard_z: 0,
					min_reach_z: 1,
					max_recognition_z: 0,
					min_reach_share: 0.6
				}
			}
		},
		disclosure: { headline: 'This ranks prominence, not merit.', items: [] },
		quality: {
			eligible_authors: 11950,
			authors_in_source: 34397,
			folds: 10,
			weights_settled_by: ''
		},
		...overrides
	};
}

const payload = { columns: COLUMNS, rows: ROWS };
const settled = [0.35, 0.35, 0.3];

describe('buildPopulation', () => {
	it('decodes the release columns', () => {
		const population = buildPopulation(payload, manifest());
		expect(population.count).toBe(5);
		expect(population.names[0]).toBe('J.K. Rowling');
		expect(population.z[0][0]).toBeCloseTo(1.937895, 6);
		expect(population.z[1][0]).toBeCloseTo(3.66119, 6);
		expect(population.bestTier[0]).toBe(2);
		expect(population.concentration[0]).toBeCloseTo(0.0649, 4);
	});

	it('accepts the optional stable author_id column', () => {
		const withIds = {
			columns: ['author_id', ...COLUMNS],
			rows: ROWS.map((row, index) => [`author-${index}`, ...row])
		};
		const population = buildPopulation(withIds, manifest());
		expect(population.authorIds).toEqual([
			'author-0',
			'author-1',
			'author-2',
			'author-3',
			'author-4'
		]);
	});

	/**
	 * Position is never load-bearing. Reversing the column order must change nothing.
	 */
	it('reads columns by name, not position', () => {
		const order = [...COLUMNS].reverse();
		const reversed = {
			columns: order,
			rows: ROWS.map((row) => [...row].reverse())
		};
		const population = buildPopulation(reversed, manifest());
		expect(population.names[0]).toBe('J.K. Rowling');
		expect(population.z[0][0]).toBeCloseTo(1.937895, 6);
		expect(population.concentration[0]).toBeCloseTo(0.0649, 4);
	});

	it('rejects a payload missing a scored column', () => {
		const dropped = COLUMNS.indexOf('reach_z');
		const broken = {
			columns: COLUMNS.filter((_, i) => i !== dropped),
			rows: ROWS.map((row) => row.filter((_, i) => i !== dropped))
		};
		expect(() => buildPopulation(broken, manifest())).toThrow(ProminenceFormatError);
	});

	it('rejects forbidden or unknown columns and short rows', () => {
		const forbidden = {
			columns: [...COLUMNS.slice(0, 4), 'n_readers', ...COLUMNS.slice(4)],
			rows: ROWS.map((row) => [...row.slice(0, 4), 123, ...row.slice(4)])
		};
		expect(() => buildPopulation(forbidden, manifest())).toThrow(/unsupported columns/);

		const short = { columns: COLUMNS, rows: [ROWS[0].slice(0, -1)] };
		expect(() => buildPopulation(short, manifest())).toThrow(/fields, expected/);
	});

	// `best_tier` is null for every author with no recorded award; 0 stands in for it.
	it('represents a null best_tier as zero', () => {
		const withNull = {
			columns: COLUMNS,
			rows: [['Nobody', 0.1, 0.1, 0.1, 2, null, 0, null, 0]]
		};
		const population = buildPopulation(withNull, manifest());
		expect(population.bestTier[0]).toBe(0);
		expect(Number.isNaN(population.concentration[0])).toBe(true);
	});
});

describe('denominator', () => {
	it('reproduces the release value at the settled weights', () => {
		expect(denominator(settled, SIGMA_Z)).toBeCloseTo(0.695842, 6);
	});

	/**
	 * The point of dividing by it: spreading weight across correlated features must not
	 * shrink the scores, or a user moving the lens reads it as the field getting worse.
	 */
	it('holds the score spread roughly constant as weight spreads', () => {
		const population = buildPopulation(payload, manifest());
		const concentrated = rank(population, [1, 0, 0], SIGMA_Z);
		const spread = rank(population, settled, SIGMA_Z);
		const top = (r: typeof spread) => r.scores[r.order[0]];
		expect(top(spread)).toBeGreaterThan(top(concentrated) * 0.5);
	});

	it('exposes raw variance and rejects non-positive scoring variance', () => {
		expect(
			rawVariance(
				[0.5, 0.5],
				[
					[1, -1],
					[-1, 1]
				]
			)
		).toBe(0);
		expect(() =>
			denominator(
				[0.5, 0.5],
				[
					[1, -1],
					[-1, 1]
				]
			)
		).toThrow(ProminenceScoringError);
		expect(() =>
			denominator(
				[1, 0],
				[
					[Number.NaN, 0],
					[0, 1]
				]
			)
		).toThrow(ProminenceScoringError);
	});
});

describe('rank', () => {
	it('reproduces the build-verified order at the settled weights', () => {
		const population = buildPopulation(payload, manifest());
		const ranking = rank(population, settled, SIGMA_Z);
		expect(Array.from(ranking.order).map((i) => population.names[i])).toEqual([
			'J.K. Rowling',
			'Percival Everett',
			'Margaret Atwood',
			'Angie Thomas',
			'Fredrik Backman'
		]);
		expect(formatScore(manifest(), ranking.scores[ranking.order[0]])).toBe('+3.54');
	});

	// The headline number has to be the sum of the bars beneath it, or the page is lying.
	it('makes the contributions sum to the score', () => {
		const population = buildPopulation(payload, manifest());
		const ranking = rank(population, settled, SIGMA_Z);
		for (let i = 0; i < population.count; i++) {
			const parts = contributions(population, i, settled, ranking.denominator);
			expect(parts.reduce((sum, value) => sum + value, 0)).toBeCloseTo(ranking.scores[i], 10);
		}
	});

	it('breaks ties by name so two clients agree', () => {
		const tied = {
			columns: COLUMNS,
			rows: [
				['Zoe Author', 1, 1, 1, 2, null, 0, 0.1, 0],
				['Alice Author', 1, 1, 1, 2, null, 0, 0.1, 0]
			]
		};
		const population = buildPopulation(tied, manifest());
		const ranking = rank(population, settled, SIGMA_Z);
		expect(Array.from(ranking.order).map((i) => population.names[i])).toEqual([
			'Alice Author',
			'Zoe Author'
		]);
	});

	it('reorders when the weights move', () => {
		const population = buildPopulation(payload, manifest());
		const decorated = rank(population, [0.2, 0.2, 0.6], SIGMA_Z);
		expect(population.names[decorated.order[0]]).toBe('Margaret Atwood');
	});

	it('places an author within the ranking', () => {
		const population = buildPopulation(payload, manifest());
		const ranking = rank(population, settled, SIGMA_Z);
		expect(placeOf(ranking, 0)).toBe(1);
		expect(placeOf(ranking, 4)).toBe(5);
	});
});

describe('auditBadges', () => {
	const base = manifest();

	// Thresholds come from the manifest that the audit approved — never from this file.
	it('flags reader enthusiasm with no corroborating awards', () => {
		const rows = [['Devoted Following', 2.5, -0.5, -0.5, 3, null, 0, 0.4, 0]];
		const population = buildPopulation({ columns: COLUMNS, rows }, base);
		const ranking = rank(population, settled, SIGMA_Z);
		const parts = contributions(population, 0, settled, ranking.denominator);
		expect(auditBadges(population, 0, parts, base).map((b) => b.badge)).toEqual([
			'Reader enthusiasm only'
		]);
	});

	it('does not flag an author whose regard is below the rule', () => {
		const rows = [['Modest', 1.0, -0.5, -0.5, 3, null, 0, 0.4, 0]];
		const population = buildPopulation({ columns: COLUMNS, rows }, base);
		const ranking = rank(population, settled, SIGMA_Z);
		const parts = contributions(population, 0, settled, ranking.denominator);
		expect(auditBadges(population, 0, parts, base)).toEqual([]);
	});

	it('flags an author carried by readership alone', () => {
		const rows = [['Widely Read', -1.0, 2.5, -1.0, 12, null, 0, 0.2, 0]];
		const population = buildPopulation({ columns: COLUMNS, rows }, base);
		const ranking = rank(population, settled, SIGMA_Z);
		const parts = contributions(population, 0, settled, ranking.denominator);
		expect(auditBadges(population, 0, parts, base).map((b) => b.badge)).toEqual([
			'Ranked on readership'
		]);
	});

	it('leaves the top of the settled ranking unflagged', () => {
		const population = buildPopulation(payload, base);
		const ranking = rank(population, settled, SIGMA_Z);
		for (let i = 0; i < population.count; i++) {
			const parts = contributions(population, i, settled, ranking.denominator);
			expect(auditBadges(population, i, parts, base)).toEqual([]);
		}
	});

	// A release whose features are renamed carries rules this client cannot apply.
	it('emits nothing when the features are not the ones the rules name', () => {
		const renamed = manifest({
			model: { ...manifest().model, features: ['alpha', 'beta', 'gamma'] }
		});
		const population = buildPopulation(payload, base);
		const ranking = rank(population, settled, SIGMA_Z);
		const parts = contributions(population, 0, settled, ranking.denominator);
		expect(auditBadges(population, 0, parts, renamed)).toEqual([]);
	});
});

describe('formatScore', () => {
	/**
	 * The Elo-shaped number must stay hidden while its slope is unfitted: a 17-point gap
	 * would mean nothing while looking as though it meant a great deal.
	 */
	it('shows the composite while the index is uncalibrated', () => {
		expect(formatScore(manifest(), 3.4844)).toBe('+3.48');
		expect(formatScore(manifest(), -0.5)).toBe('-0.50');
		expect(formatScore(manifest(), 0)).toBe('+0.00');
	});

	it('shows the rating scale once the build declares it calibrated', () => {
		const calibrated = manifest({
			model: { ...manifest().model, index_is_calibrated_elo: true }
		});
		expect(formatScore(calibrated, 3.4844)).toBe('2105');
	});

	it('signs contribution labels', () => {
		expect(formatContribution(0.8)).toBe('+0.80');
		expect(formatContribution(-0.8)).toBe('-0.80');
	});
});
