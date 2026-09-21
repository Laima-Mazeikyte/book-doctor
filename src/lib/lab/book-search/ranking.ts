import {
	BookRankingFormatError,
	FEATURE_COUNT,
	type BookPopulation,
	type BookRankingManifest,
	type BookRanking,
	type RankingMode,
	type RankingPayload
} from './types';

// Matches the exporter's SCORE_PROBABILITY_MIN/MAX clip.
const PROBABILITY_MIN = 1e-6;
const PROBABILITY_MAX = 1 - 1e-6;

// Normalize once per immutable release population, including in the background search worker.
export type SearchPopulation = Pick<BookPopulation, 'titles' | 'authors' | 'seriesNames'>;
const searchIndexes = new WeakMap<SearchPopulation, Array<[string, string, string]>>();

export function prepareSearchIndex(population: SearchPopulation): Array<[string, string, string]> {
	const cached = searchIndexes.get(population);
	if (cached) return cached;
	const index = population.titles.map((title, index): [string, string, string] => [
		searchable(title),
		searchable(population.authors[index]),
		searchable(population.seriesNames[index])
	]);
	searchIndexes.set(population, index);
	return index;
}

function featureColumn(feature: string): string {
	return feature.endsWith('_z') ? feature : `${feature}_z`;
}

export function isPolarizing(mode: RankingMode): boolean {
	return mode.startsWith('polarizing_');
}

function columnIndex(columns: string[], name: string): number {
	const index = columns.indexOf(name);
	if (index < 0) {
		throw new BookRankingFormatError(`Ranking data is missing the "${name}" column.`);
	}
	return index;
}

function optionalString(row: unknown[], index: number): string | null {
	if (row[index] == null || String(row[index]).trim() === '') return null;
	return String(row[index]);
}

/** Decode a public payload without retaining one object per row. */
export function buildPopulation(
	payload: RankingPayload,
	manifest: BookRankingManifest,
	mode: RankingMode
): BookPopulation {
	const model = manifest.model[mode];
	if (!model || model.features.length !== FEATURE_COUNT) {
		throw new BookRankingFormatError(`The ${mode} model must declare three features.`);
	}

	const { columns, rows } = payload;
	const itemType = columnIndex(columns, 'item_type');
	const title = columnIndex(columns, 'title');
	const author = columnIndex(columns, 'author');
	const seriesName = columnIndex(columns, 'series_name');
	const constituentIds = columnIndex(columns, 'constituent_book_ids');
	const zColumns = model.features.map((feature) => columnIndex(columns, featureColumn(feature)));
	const reach = isPolarizing(mode) ? columnIndex(columns, 'cultural_reach_z') : -1;

	if (rows.length === 0) throw new BookRankingFormatError(`${mode} contains no rankable items.`);

	const count = rows.length;
	const itemTypes: BookPopulation['itemTypes'] = new Array(count);
	const titles: string[] = new Array(count);
	const authors: string[] = new Array(count);
	const seriesNames: Array<string | null> = new Array(count);
	const constituentBookIds: string[][] = new Array(count);
	const z = zColumns.map(() => new Float64Array(count));
	const culturalReachZ = reach >= 0 ? new Float64Array(count) : null;

	for (let index = 0; index < count; index++) {
		const row = rows[index];
		titles[index] = String(row[title]);
		authors[index] = String(row[author]);
		seriesNames[index] = optionalString(row, seriesName);
		const type = row[itemType];
		if (type !== 'book' && type !== 'series') {
			throw new BookRankingFormatError(`Ranking row ${index} has an invalid item_type.`);
		}
		itemTypes[index] = type;
		const constituents = row[constituentIds];
		if (!Array.isArray(constituents) || constituents.some((id) => typeof id !== 'string')) {
			throw new BookRankingFormatError(
				`Ranking row ${index} must contain an array of source book IDs.`
			);
		}
		// Source IDs for books; accepted core volumes in reading order for series.
		constituentBookIds[index] = constituents;

		for (let feature = 0; feature < zColumns.length; feature++) {
			const value = Number(row[zColumns[feature]]);
			if (!Number.isFinite(value)) {
				throw new BookRankingFormatError(
					`Ranking row ${index} has a non-finite ${model.features[feature]} score.`
				);
			}
			z[feature][index] = value;
		}
		if (culturalReachZ) {
			const value = Number(row[reach]);
			if (!Number.isFinite(value)) {
				throw new BookRankingFormatError(`Ranking row ${index} has a non-finite reach score.`);
			}
			culturalReachZ[index] = value;
		}
	}

	return {
		mode,
		count,
		itemTypes,
		titles,
		authors,
		seriesNames,
		constituentBookIds,
		z,
		culturalReachZ
	};
}

export function normaliseWeights(raw: number[], fallback: number[]): number[] {
	const total = raw.reduce((sum, value) => sum + Math.max(value, 0), 0);
	return total > 0 ? raw.map((value) => Math.max(value, 0) / total) : fallback.slice();
}

export function handlePositions(weights: number[]): number[] {
	const largest = Math.max(...weights);
	if (!(largest > 0)) return weights.map(() => 0);
	return weights.map((weight) => Math.round((Math.max(weight, 0) / largest) * 100));
}

export function denominator(weights: number[], sigmaZ: number[][]): number {
	let total = 0;
	for (let i = 0; i < weights.length; i++) {
		for (let j = 0; j < weights.length; j++) {
			total += weights[i] * sigmaZ[i][j] * weights[j];
		}
	}
	return total > 0 ? Math.sqrt(total) : 1;
}

/** Normal CDF via Numerical Recipes' erfc approximation (fractional error < 1.2e-7). */
export function normalCdf(value: number): number {
	const x = -value / Math.SQRT2;
	const z = Math.abs(x);
	const t = 1 / (1 + 0.5 * z);
	const erfc =
		t *
		Math.exp(
			-z * z -
				1.26551223 +
				t *
					(1.00002368 +
						t *
							(0.37409196 +
								t *
									(0.09678418 +
										t *
											(-0.18628806 +
												t *
													(0.27886807 +
														t *
															(-1.13520398 +
																t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
		);
	return 0.5 * (x >= 0 ? erfc : 2 - erfc);
}

const ACKLAM_A = [
	-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
	-3.066479806614716e1, 2.506628277459239
];
const ACKLAM_B = [
	-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
	-1.328068155288572e1
];
const ACKLAM_C = [
	-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
	4.374664141464968, 2.938163982698783
];
const ACKLAM_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
const ACKLAM_LOW = 0.02425;

/** Inverse normal CDF (Acklam's rational approximation, relative error < 1.2e-9). */
export function inverseNormalCdf(probability: number): number {
	if (!(probability > 0)) return -Infinity;
	if (!(probability < 1)) return Infinity;
	const [a0, a1, a2, a3, a4, a5] = ACKLAM_A;
	const [b0, b1, b2, b3, b4] = ACKLAM_B;
	const [c0, c1, c2, c3, c4, c5] = ACKLAM_C;
	const [d0, d1, d2, d3] = ACKLAM_D;
	if (probability < ACKLAM_LOW || probability > 1 - ACKLAM_LOW) {
		const tail = Math.sqrt(-2 * Math.log(Math.min(probability, 1 - probability)));
		const value =
			(((((c0 * tail + c1) * tail + c2) * tail + c3) * tail + c4) * tail + c5) /
			((((d0 * tail + d1) * tail + d2) * tail + d3) * tail + 1);
		return probability < ACKLAM_LOW ? value : -value;
	}
	const q = probability - 0.5;
	const r = q * q;
	return (
		((((((a0 * r + a1) * r + a2) * r + a3) * r + a4) * r + a5) * q) /
		(((((b0 * r + b1) * r + b2) * r + b3) * r + b4) * r + 1)
	);
}

function clippedPercentile(value: number): number {
	return Math.min(Math.max(normalCdf(value), PROBABILITY_MIN), PROBABILITY_MAX);
}

/** Rank every row at the chosen weights; the full population remains rankable after a drag. */
export function rank(
	population: BookPopulation,
	weights: number[],
	sigmaZ: number[][],
	reachShare = 0
): BookRanking {
	const { count, z, culturalReachZ, titles } = population;
	const denom = denominator(weights, sigmaZ);
	const scores = new Float64Array(count);

	for (let index = 0; index < count; index++) {
		let statistical = 0;
		for (let feature = 0; feature < weights.length; feature++) {
			statistical += weights[feature] * z[feature][index];
		}
		statistical /= denom;
		if (culturalReachZ) {
			// Blend the two percentiles geometrically, then map back onto the z scale so the
			// score stays uncapped and equals the statistical score when popularity is off.
			const blend = Math.exp(
				(1 - reachShare) * Math.log(clippedPercentile(statistical)) +
					reachShare * Math.log(clippedPercentile(culturalReachZ[index]))
			);
			scores[index] = inverseNormalCdf(blend);
		} else {
			scores[index] = statistical;
		}
	}

	const order = new Int32Array(count);
	for (let index = 0; index < count; index++) order[index] = index;
	order.sort(
		(a, b) =>
			scores[b] - scores[a] || (titles[a] < titles[b] ? -1 : titles[a] > titles[b] ? 1 : a - b)
	);

	const places = new Int32Array(count);
	for (let position = 0; position < count; position++) places[order[position]] = position + 1;
	return { order, places, scores };
}

export function placeOf(ranking: BookRanking, index: number): number {
	return ranking.places[index] ?? 0;
}

/** Signed two-decimal ranking score, on a z-like scale for both tabs. */
export function formatScore(value: number): string {
	return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function searchable(value: string | null | undefined): string {
	return (value ?? '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase();
}

export function matchingIndices(
	population: SearchPopulation,
	ranking: Pick<BookRanking, 'order'>,
	query: string
): number[] {
	const needle = searchable(query.trim());
	if (!needle) return Array.from(ranking.order);
	const text = prepareSearchIndex(population);
	const matches: number[] = [];
	for (const index of ranking.order) {
		const fields = text[index];
		if (fields[0].includes(needle) || fields[1].includes(needle) || fields[2].includes(needle)) {
			matches.push(index);
		}
	}
	return matches;
}
