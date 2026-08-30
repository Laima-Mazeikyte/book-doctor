import {
	ProminenceFormatError,
	ProminenceScoringError,
	type Badge,
	type Contributions,
	type Population,
	type ProminenceManifest,
	type Ranking
} from './types';

/**
 * Client-side scoring for the prominence release.
 *
 * The build ships normal-scored features and the correlation matrix between them; the
 * ranking itself is computed here because it depends entirely on the weight vector, and
 * the weight space is continuous. A precomputed shortlist would silently return a wrong
 * last place for any weights a sampling grid missed.
 *
 * Verified against the release: `rank` at `model.default_weights` reproduces the build's
 * own `run_manifest.verified_top` exactly.
 */

/** Column suffix convention: feature `regard` is carried by column `regard_z`. */
function zColumn(feature: string): string {
	return `${feature}_z`;
}

const REQUIRED_V2_COLUMNS = [
	'author',
	'regard_z',
	'reach_z',
	'recognition_z',
	'n_books',
	'best_tier',
	'n_awards',
	'concentration',
	'has_recognition'
] as const;
const OPTIONAL_V2_COLUMNS = ['author_id'] as const;

/**
 * Decode `authors.json` into column arrays.
 *
 * Columns are read by name via the payload's own `columns` array — never by position —
 * while the v2 allowlist and exact row widths prevent an accidental v1 or future sensitive
 * field from entering the browser contract.
 */
export function buildPopulation(
	payload: { columns: string[]; rows: unknown[][] },
	manifest: ProminenceManifest
): Population {
	if (!payload || !Array.isArray(payload.columns) || !Array.isArray(payload.rows))
		throw new ProminenceFormatError('authors.json must contain columns and rows arrays.');
	if (manifest.schema_version !== 2)
		throw new ProminenceFormatError(
			'authors.json requires an author-prominence schema_version 2 manifest.'
		);
	if (payload.columns.some((name) => typeof name !== 'string' || !name.trim()))
		throw new ProminenceFormatError('authors.json contains an empty column name.');
	if (new Set(payload.columns).size !== payload.columns.length)
		throw new ProminenceFormatError('authors.json contains duplicate column names.');
	const allowed = new Set<string>([...REQUIRED_V2_COLUMNS, ...OPTIONAL_V2_COLUMNS]);
	const unexpected = payload.columns.filter((name) => !allowed.has(name));
	if (unexpected.length)
		throw new ProminenceFormatError(
			`schema_version 2 authors.json contains unsupported columns: ${unexpected.join(', ')}.`
		);
	const missing = REQUIRED_V2_COLUMNS.filter((name) => !payload.columns.includes(name));
	if (missing.length)
		throw new ProminenceFormatError(
			`schema_version 2 authors.json is missing required columns: ${missing.join(', ')}.`
		);
	if (
		payload.columns.length !== REQUIRED_V2_COLUMNS.length &&
		payload.columns.length !== REQUIRED_V2_COLUMNS.length + OPTIONAL_V2_COLUMNS.length
	)
		throw new ProminenceFormatError(
			`schema_version 2 authors.json must contain ${REQUIRED_V2_COLUMNS.length} columns, plus optional author_id.`
		);
	const index = new Map(payload.columns.map((name, i) => [name, i]));

	const rows = payload.rows;
	const count = rows.length;
	if (count === 0) {
		throw new ProminenceFormatError('authors.json contains no authors.');
	}

	const at = (name: string): number => index.get(name) ?? -1;
	const authorCol = at('author');
	const zCols = manifest.model.features.map((feature) => at(zColumn(feature)));
	const hasRecognitionCol = at('has_recognition');
	const nBooksCol = at('n_books');
	const bestTierCol = at('best_tier');
	const nAwardsCol = at('n_awards');
	const concentrationCol = at('concentration');
	const authorIdCol = at('author_id');

	const names: string[] = new Array(count);
	const authorIds: string[] | null = authorIdCol >= 0 ? new Array(count) : null;
	const z = zCols.map(() => new Float64Array(count));
	const hasRecognition = new Uint8Array(count);
	const nBooks = new Int32Array(count);
	const bestTier = new Int8Array(count);
	const nAwards = new Int32Array(count);
	const concentration = new Float64Array(count);
	const seenNames = new Set<string>();
	const seenIds = new Set<string>();

	const numberAt = (
		row: unknown[],
		col: number,
		label: string,
		nullable = false
	): number | null => {
		const raw = row[col];
		if (raw === null && nullable) return null;
		if (typeof raw !== 'number' || !Number.isFinite(raw))
			throw new ProminenceFormatError(`authors.json contains an invalid ${label}.`);
		return raw;
	};
	const integerAt = (
		row: unknown[],
		col: number,
		label: string,
		minimum: number,
		maximum?: number,
		nullable = false
	): number | null => {
		const value = numberAt(row, col, label, nullable);
		if (value === null) return null;
		if (!Number.isInteger(value) || value < minimum || (maximum !== undefined && value > maximum))
			throw new ProminenceFormatError(`authors.json contains an invalid ${label}.`);
		return value;
	};

	for (let i = 0; i < count; i++) {
		const row = rows[i];
		if (!Array.isArray(row))
			throw new ProminenceFormatError(`authors.json row ${i} is not an array.`);
		if (row.length !== payload.columns.length)
			throw new ProminenceFormatError(
				`authors.json row ${i} has ${row.length} fields, expected ${payload.columns.length}.`
			);
		const name = typeof row[authorCol] === 'string' ? row[authorCol].trim() : '';
		if (!name) throw new ProminenceFormatError(`authors.json row ${i} has an empty author name.`);
		if (!authorIds && seenNames.has(name))
			throw new ProminenceFormatError(`authors.json contains duplicate author name "${name}".`);
		names[i] = name;
		seenNames.add(name);
		if (authorIds) {
			const id = typeof row[authorIdCol] === 'string' ? row[authorIdCol].trim() : '';
			if (!id) throw new ProminenceFormatError(`authors.json row ${i} has an empty author_id.`);
			if (seenIds.has(id))
				throw new ProminenceFormatError(`authors.json contains duplicate author_id "${id}".`);
			authorIds[i] = id;
			seenIds.add(id);
		}

		for (let f = 0; f < zCols.length; f++) {
			const value = numberAt(row, zCols[f], `${manifest.model.features[f]} score`);
			if (value === null)
				throw new ProminenceFormatError(
					`authors.json row ${i} has a null ${manifest.model.features[f]} score.`
				);
			z[f][i] = value;
		}

		const recognition = integerAt(row, hasRecognitionCol, 'has_recognition', 0, 1);
		if (recognition === null)
			throw new ProminenceFormatError(`authors.json row ${i} has a null has_recognition value.`);
		hasRecognition[i] = recognition;
		const books = integerAt(row, nBooksCol, 'n_books', 0);
		if (books === null)
			throw new ProminenceFormatError(`authors.json row ${i} has a null n_books value.`);
		nBooks[i] = books;
		// `best_tier` is null for the ~45% of authors with no recorded award; 0 stands in.
		bestTier[i] = integerAt(row, bestTierCol, 'best_tier', 0, 5, true) ?? 0;
		const awards = integerAt(row, nAwardsCol, 'n_awards', 0);
		if (awards === null)
			throw new ProminenceFormatError(`authors.json row ${i} has a null n_awards value.`);
		nAwards[i] = awards;
		const concentrationValue = numberAt(row, concentrationCol, 'concentration', true);
		if (concentrationValue !== null && (concentrationValue < 0 || concentrationValue > 1))
			throw new ProminenceFormatError(`authors.json row ${i} has an invalid concentration.`);
		concentration[i] = concentrationValue ?? Number.NaN;
	}

	return {
		count,
		names,
		authorIds,
		z,
		hasRecognition,
		nBooks,
		bestTier,
		nAwards,
		concentration
	};
}

/** Minimum raw variance accepted for a normalized feature combination. */
export const MIN_RAW_VARIANCE = 1e-12;
/** Entry tolerance for generated correlation matrices. */
export const MATRIX_ENTRY_TOLERANCE = 1e-8;
/** Relative tolerance used for symmetry checks. */
export const MATRIX_SYMMETRY_TOLERANCE = 1e-10;
/** Relative pivot tolerance used by the positive-definite check. */
export const MATRIX_PD_TOLERANCE = 1e-14;

/** The raw quadratic variance wᵀΣw. It never substitutes a fallback value. */
export function rawVariance(weights: number[], sigmaZ: number[][]): number {
	let total = 0;
	for (let i = 0; i < weights.length; i++) {
		for (let j = 0; j < weights.length; j++) {
			total += weights[i] * sigmaZ[i]?.[j] * weights[j];
		}
	}
	return total;
}

/** Validate sigma_z as a finite, symmetric, positive-definite correlation matrix. */
export function validateCorrelationMatrix(sigmaZ: unknown, expectedSize: number): void {
	if (!Array.isArray(sigmaZ) || sigmaZ.length !== expectedSize) {
		throw new ProminenceFormatError(
			`sigma_z must be ${expectedSize}×${expectedSize} for the scored features.`
		);
	}
	for (let rowIndex = 0; rowIndex < expectedSize; rowIndex++) {
		const row = sigmaZ[rowIndex];
		if (!Array.isArray(row) || row.length !== expectedSize || !row.every(Number.isFinite)) {
			throw new ProminenceFormatError(
				`sigma_z row ${rowIndex} must be finite and ${expectedSize} cells wide.`
			);
		}
	}

	let norm = 1;
	for (const row of sigmaZ as number[][]) {
		norm = Math.max(
			norm,
			row.reduce((sum, value) => sum + Math.abs(value), 0)
		);
	}
	const symmetryTolerance = MATRIX_SYMMETRY_TOLERANCE * norm;
	for (let rowIndex = 0; rowIndex < expectedSize; rowIndex++) {
		const row = (sigmaZ as number[][])[rowIndex];
		if (Math.abs(row[rowIndex] - 1) > MATRIX_ENTRY_TOLERANCE) {
			throw new ProminenceFormatError(
				'sigma_z must have diagonal values approximately equal to 1.'
			);
		}
		for (let column = rowIndex + 1; column < expectedSize; column++) {
			const value = row[column];
			if (Math.abs(value - (sigmaZ as number[][])[column][rowIndex]) > symmetryTolerance) {
				throw new ProminenceFormatError('sigma_z must be symmetric within numerical tolerance.');
			}
			if (value < -1 - MATRIX_ENTRY_TOLERANCE || value > 1 + MATRIX_ENTRY_TOLERANCE) {
				throw new ProminenceFormatError(
					'sigma_z off-diagonal correlations must be within [-1, 1].'
				);
			}
		}
	}

	// Cholesky rejects singular and indefinite matrices. The pivot tolerance scales with
	// the matrix norm so generated releases are not judged against an absolute magnitude.
	const matrix = sigmaZ as number[][];
	const lower = Array.from({ length: expectedSize }, () => new Array(expectedSize).fill(0));
	const pivotTolerance = MATRIX_PD_TOLERANCE * norm;
	for (let row = 0; row < expectedSize; row++) {
		for (let column = 0; column <= row; column++) {
			let pivot = matrix[row][column];
			for (let previous = 0; previous < column; previous++) {
				pivot -= lower[row][previous] * lower[column][previous];
			}
			if (row === column) {
				if (!(pivot > pivotTolerance) || !Number.isFinite(pivot)) {
					throw new ProminenceFormatError(
						'sigma_z must be positive-definite, not singular or indefinite.'
					);
				}
				lower[row][column] = Math.sqrt(pivot);
			} else {
				lower[row][column] = pivot / lower[column][column];
			}
		}
	}
}

/**
 * sqrt(wᵀ · sigma_z · w).
 *
 * Dividing the score by this is **not optional**: it holds the score's spread constant as
 * the weights move. Without it the score compresses whenever weight is spread across
 * features, and a user moving the lens reads that as the whole field getting worse.
 */
export function denominator(weights: number[], sigmaZ: number[][]): number {
	const variance = rawVariance(weights, sigmaZ);
	if (!Number.isFinite(variance) || variance <= MIN_RAW_VARIANCE) {
		throw new ProminenceScoringError(
			`The scoring variance must be finite and greater than ${MIN_RAW_VARIANCE}.`
		);
	}
	return Math.sqrt(variance);
}

/**
 * Rank the whole population at the given weights, best first.
 *
 * Every eligible author is scored even though only `display.top_n` are shown — which
 * authors reach the top depends entirely on the weight vector. Ties break by name so two
 * clients at identical weights produce identical lists.
 */
export function rank(population: Population, weights: number[], sigmaZ: number[][]): Ranking {
	const { count, names, z } = population;
	const denom = denominator(weights, sigmaZ);
	const scores = new Float64Array(count);

	for (let f = 0; f < weights.length; f++) {
		const weight = weights[f] / denom;
		if (weight === 0) continue;
		const column = z[f];
		for (let i = 0; i < count; i++) {
			scores[i] += weight * column[i];
		}
	}

	const order = new Int32Array(count);
	for (let i = 0; i < count; i++) order[i] = i;
	// Int32Array.prototype.sort is numeric by default, so the comparator is required.
	order.sort(
		(a, b) => scores[b] - scores[a] || (names[a] < names[b] ? -1 : names[a] > names[b] ? 1 : a - b)
	);

	return { order, scores, denominator: denom };
}

/** Per-feature contributions for one author. These sum to that author's score. */
export function contributions(
	population: Population,
	authorIndex: number,
	weights: number[],
	denom: number
): Contributions {
	return weights.map((weight, f) => (weight * population.z[f][authorIndex]) / denom);
}

/** Position of an author within a ranking, 1-based. */
export function placeOf(ranking: Ranking, authorIndex: number): number {
	return ranking.order.indexOf(authorIndex) + 1;
}

/**
 * Audit badges for one author.
 *
 * Every threshold comes from `manifest.audit`, which the build wrote. Nothing numeric is
 * defined here: a page flagging authors under different rules from the audit that approved
 * the release is worse than no badge at all.
 */
export function auditBadges(
	population: Population,
	authorIndex: number,
	values: Contributions,
	manifest: ProminenceManifest
): Badge[] {
	const features = manifest.model.features;
	const regard = features.indexOf('regard');
	const reach = features.indexOf('reach');
	const recognition = features.indexOf('recognition');
	// A release whose features are named differently carries rules we cannot apply.
	if (regard < 0 || reach < 0 || recognition < 0) return [];

	const { regard_only: regardOnly, reach_only: reachOnly } = manifest.audit;
	const z = population.z;
	const badges: Badge[] = [];

	if (
		!population.hasRecognition[authorIndex] &&
		z[regard][authorIndex] > regardOnly.rule.min_regard_z
	) {
		badges.push({ badge: regardOnly.badge, explain: regardOnly.explain });
	}

	const positive = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
	if (
		z[regard][authorIndex] < reachOnly.rule.max_regard_z &&
		z[reach][authorIndex] > reachOnly.rule.min_reach_z &&
		z[recognition][authorIndex] < reachOnly.rule.max_recognition_z &&
		positive > 0 &&
		values[reach] > reachOnly.rule.min_reach_share * positive
	) {
		badges.push({ badge: reachOnly.badge, explain: reachOnly.explain });
	}

	return badges;
}

/** Whether the rating-style scale has been fitted against pairwise reader preferences. */
export function isCalibrated(manifest: ProminenceManifest): boolean {
	return Boolean(manifest.model.index_is_calibrated_elo);
}

/**
 * The score as displayed.
 *
 * While uncalibrated we show the composite itself (`+3.48`). It is in the same units as
 * the contribution bars, so the bars visibly sum to the headline number — a property
 * nothing else on the page has. The Elo-shaped `index_base + index_scale · T` is
 * deliberately not rendered: its slope has never been fitted against pairwise reader
 * preferences, so a 17-point gap would mean nothing while looking as though it meant a
 * great deal. If that calibration is ever done, the flag flips and the scale becomes
 * legitimate.
 */
export function formatScore(manifest: ProminenceManifest, score: number): string {
	if (isCalibrated(manifest)) {
		return String(Math.round(manifest.model.index_base + manifest.model.index_scale * score));
	}
	return `${score >= 0 ? '+' : ''}${score.toFixed(2)}`;
}

/** Signed contribution value for a bar label. */
export function formatContribution(value: number): string {
	return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
