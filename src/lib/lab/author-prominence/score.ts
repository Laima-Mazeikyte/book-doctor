import {
	ProminenceFormatError,
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

/**
 * Decode `authors.json` into column arrays.
 *
 * Columns are read by name via the payload's own `columns` array — never by position —
 * because the release contract allows new columns to be appended without a schema bump.
 */
export function buildPopulation(
	payload: { columns: string[]; rows: unknown[][] },
	manifest: ProminenceManifest
): Population {
	const index = new Map(payload.columns.map((name, i) => [name, i]));

	const required = ['author', 'has_recognition', ...manifest.model.features.map(zColumn)];
	for (const name of required) {
		if (!index.has(name)) {
			throw new ProminenceFormatError(`authors.json is missing the "${name}" column.`);
		}
	}

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
	const nReadersCol = at('n_readers');
	const bestTierCol = at('best_tier');
	const nAwardsCol = at('n_awards');
	const concentrationCol = at('concentration');

	const names: string[] = new Array(count);
	const z = zCols.map(() => new Float64Array(count));
	const hasRecognition = new Uint8Array(count);
	const nBooks = new Int32Array(count);
	const nReaders = new Int32Array(count);
	const bestTier = new Int8Array(count);
	const nAwards = new Int32Array(count);
	const concentration = new Float64Array(count);

	/** Optional columns read as 0; a null `concentration` reads as NaN and is hidden. */
	const numberAt = (row: unknown[], col: number): number =>
		col < 0 || row[col] == null ? 0 : Number(row[col]);

	for (let i = 0; i < count; i++) {
		const row = rows[i];
		names[i] = String(row[authorCol]);

		for (let f = 0; f < zCols.length; f++) {
			const value = Number(row[zCols[f]]);
			if (!Number.isFinite(value)) {
				throw new ProminenceFormatError(
					`authors.json row ${i} has a non-finite ${manifest.model.features[f]} score.`
				);
			}
			z[f][i] = value;
		}

		hasRecognition[i] = numberAt(row, hasRecognitionCol) ? 1 : 0;
		nBooks[i] = numberAt(row, nBooksCol);
		nReaders[i] = numberAt(row, nReadersCol);
		// `best_tier` is null for the ~45% of authors with no recorded award; 0 stands in.
		bestTier[i] = numberAt(row, bestTierCol);
		nAwards[i] = numberAt(row, nAwardsCol);
		concentration[i] =
			concentrationCol < 0 || row[concentrationCol] == null
				? Number.NaN
				: Number(row[concentrationCol]);
	}

	return {
		count,
		names,
		z,
		hasRecognition,
		nBooks,
		nReaders,
		bestTier,
		nAwards,
		concentration
	};
}

/** Weights normalised to sum to 1, falling back to the settled default if they sum to 0. */
export function normaliseWeights(raw: number[], fallback: number[]): number[] {
	const total = raw.reduce((sum, value) => sum + Math.max(value, 0), 0);
	if (total <= 0) return fallback.slice();
	return raw.map((value) => Math.max(value, 0) / total);
}

/**
 * Slider positions that represent a weight vector, scaled so the largest sits at the top of
 * its track.
 *
 * Only the ratio between the handles matters, so a preset can be drawn anywhere along the
 * track. Drawing `[0.35, 0.35, 0.30]` at 35/35/30 puts every handle near the bottom, which
 * reads as "none of this matters to me" — the opposite of what the settled default means.
 * Scaling to 100/100/86 says the same thing and looks like it.
 */
export function handlePositions(weights: number[]): number[] {
	const largest = Math.max(...weights);
	if (!(largest > 0)) return weights.map(() => 0);
	return weights.map((weight) => Math.round((Math.max(weight, 0) / largest) * 100));
}

/**
 * sqrt(wᵀ · sigma_z · w).
 *
 * Dividing the score by this is **not optional**: it holds the score's spread constant as
 * the weights move. Without it the score compresses whenever weight is spread across
 * features, and a user moving sliders reads that as the whole field getting worse.
 */
export function denominator(weights: number[], sigmaZ: number[][]): number {
	let total = 0;
	for (let i = 0; i < weights.length; i++) {
		for (let j = 0; j < weights.length; j++) {
			total += weights[i] * sigmaZ[i][j] * weights[j];
		}
	}
	// Guarded because a degenerate matrix would otherwise produce Infinity scores.
	return total > 0 ? Math.sqrt(total) : 1;
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
	order.sort((a, b) => scores[b] - scores[a] || (names[a] < names[b] ? -1 : 1));

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

/**
 * Half-width scale for the diverging contribution bars: the largest absolute contribution
 * anywhere in the displayed set, so bars are comparable across authors on screen.
 */
export function barScale(
	population: Population,
	authorIndices: ArrayLike<number>,
	weights: number[],
	denom: number
): number {
	let largest = 0;
	for (let i = 0; i < authorIndices.length; i++) {
		for (const value of contributions(population, authorIndices[i], weights, denom)) {
			const magnitude = Math.abs(value);
			if (magnitude > largest) largest = magnitude;
		}
	}
	return largest > 0 ? largest : 1;
}
