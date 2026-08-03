import {
	BookRankingFormatError,
	type BookPopulation,
	type BookRankingManifest,
	type BookRanking,
	type RankingMode,
	type RankingPayload
} from './types';

const FEATURE_COUNT = 3;
const CDF_FLOOR = 1e-6;

function featureColumn(feature: string): string {
	return feature.endsWith('_z') ? feature : `${feature}_z`;
}

function isPolarizing(mode: RankingMode): boolean {
	return mode.startsWith('polarizing_');
}

function columnIndex(columns: string[], name: string, required = true): number {
	const index = columns.indexOf(name);
	if (index < 0 && required) {
		throw new BookRankingFormatError(`Ranking data is missing the "${name}" column.`);
	}
	return index;
}

function optionalString(row: unknown[], index: number): string | null {
	if (index < 0 || row[index] == null || String(row[index]).trim() === '') return null;
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
	const itemId = columnIndex(columns, 'item_id');
	const title = columnIndex(columns, 'title');
	const author = columnIndex(columns, 'author');
	const seriesName = columnIndex(columns, 'series_name');
	const constituentIds = columnIndex(columns, 'constituent_book_ids', false);
	const zColumns = model.features.map((feature) => columnIndex(columns, featureColumn(feature)));
	const reach = isPolarizing(mode) ? columnIndex(columns, 'cultural_reach_z') : -1;

	if (rows.length === 0) throw new BookRankingFormatError(`${mode} contains no rankable items.`);

	const count = rows.length;
	const itemIds: string[] = new Array(count);
	const titles: string[] = new Array(count);
	const authors: string[] = new Array(count);
	const seriesNames: Array<string | null> = new Array(count);
	const constituentBookIds: string[][] = new Array(count);
	const z = zColumns.map(() => new Float64Array(count));
	const culturalReachZ = reach >= 0 ? new Float64Array(count) : null;

	for (let index = 0; index < count; index++) {
		const row = rows[index];
		itemIds[index] = String(row[itemId]);
		titles[index] = String(row[title]);
		authors[index] = String(row[author]);
		seriesNames[index] = optionalString(row, seriesName);
		const rawConstituents = constituentIds >= 0 ? row[constituentIds] : null;
		const constituents = Array.isArray(rawConstituents)
			? rawConstituents.filter((value): value is string => typeof value === 'string')
			: [];
		// The exporter guarantees distinct IDs in sequel order. Preserve the complete series
		// so the UI can render every constituent book.
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
		itemIds,
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

/** Abramowitz and Stegun's compact normal CDF approximation. */
export function normalCdf(value: number): number {
	const sign = value < 0 ? -1 : 1;
	const scaled = Math.abs(value) / Math.sqrt(2);
	const t = 1 / (1 + 0.3275911 * scaled);
	const polynomial =
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
	const y = 1 - polynomial * Math.exp(-scaled * scaled);
	return 0.5 * (1 + sign * y);
}

/** Rank every row at the chosen weights; the full population remains rankable after a drag. */
export function rank(
	population: BookPopulation,
	weights: number[],
	sigmaZ: number[][],
	reachShare = 0
): BookRanking {
	const { count, z, culturalReachZ, mode } = population;
	const denom = denominator(weights, sigmaZ);
	const scores = new Float64Array(count);
	const statisticalScores = new Float64Array(count);
	const contributions = weights.map(() => new Float64Array(count));

	for (let index = 0; index < count; index++) {
		let statistical = 0;
		for (let feature = 0; feature < weights.length; feature++) {
			const contribution = (weights[feature] * z[feature][index]) / denom;
			contributions[feature][index] = contribution;
			statistical += contribution;
		}
		statisticalScores[index] = statistical;
		if (isPolarizing(mode) && culturalReachZ) {
			const statisticalPercentile = Math.max(normalCdf(statistical), CDF_FLOOR);
			const reachPercentile = Math.max(normalCdf(culturalReachZ[index]), CDF_FLOOR);
			scores[index] = Math.exp(
				(1 - reachShare) * Math.log(statisticalPercentile) + reachShare * Math.log(reachPercentile)
			);
		} else {
			scores[index] = statistical;
		}
	}

	const order = new Int32Array(count);
	for (let index = 0; index < count; index++) order[index] = index;
	order.sort(
		(a, b) =>
			scores[b] - scores[a] ||
			(population.titles[a] < population.titles[b]
				? -1
				: population.titles[a] > population.titles[b]
					? 1
					: a - b)
	);

	return { order, scores, statisticalScores, contributions, denominator: denom, reachShare };
}

export function placeOf(ranking: BookRanking, index: number): number {
	return ranking.order.indexOf(index) + 1;
}

export function barScale(ranking: BookRanking, indices: ArrayLike<number>): number {
	let largest = 0;
	for (let feature = 0; feature < ranking.contributions.length; feature++) {
		for (let index = 0; index < indices.length; index++) {
			largest = Math.max(largest, Math.abs(ranking.contributions[feature][indices[index]]));
		}
	}
	return largest > 0 ? largest : 1;
}

export function formatScore(mode: RankingMode, value: number): string {
	if (isPolarizing(mode)) return value.toFixed(3);
	return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

export function formatContribution(value: number): string {
	return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function searchable(value: string | null | undefined): string {
	return (value ?? '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase();
}

export function matchingIndices(
	population: BookPopulation,
	ranking: BookRanking,
	query: string
): number[] {
	const needle = searchable(query.trim());
	if (!needle) return Array.from(ranking.order);
	return Array.from(ranking.order).filter((index) =>
		[population.titles[index], population.authors[index], population.seriesNames[index]].some(
			(value) => searchable(value).includes(needle)
		)
	);
}
