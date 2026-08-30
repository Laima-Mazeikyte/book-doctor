import { contributions, denominator } from './score';
import { largestRemainderShares, presetForWeights, type LensSnapshot } from './lens';
import type { Population, Preset } from './types';

export interface RankingResult {
	/** Monotonically increasing request revision. */
	revision: number;
	/** Exact lens snapshot used for every value in this result. */
	lens: LensSnapshot;
	/** Immutable copy of the exact request weights for defensive consumers. */
	weights: number[];
	denominator: number;
	/** The complete overlay population, bounded to 250 by product contract. */
	top250: Int32Array;
	/** Complete 1-based rank for every population index. */
	rankByIndex: Int32Array;
	/** Scores and contributions for the displayed leaders plus the selected author. */
	scoreIndices: Int32Array;
	scoreValues: Float64Array;
	contributionValues: Float64Array;
	rankBuckets: Uint8Array;
	selectedIndex: number | null;
	selectedContributions: Float64Array | null;
	topN: number;
}

export interface RankingEngineInput {
	population: Population;
	sigmaZ: number[][];
	settledPreset: Preset;
	topN: number;
	weights: number[];
	selectedIndex: number | null;
	revision: number;
}

export function rankingLensSnapshot(weights: number[], settledPreset: Preset): LensSnapshot {
	const exactWeights = weights.slice();
	const preset = presetForWeights(exactWeights, [settledPreset]);
	return {
		weights: exactWeights,
		displayShares: largestRemainderShares(exactWeights),
		source: preset ? 'preset' : 'custom',
		presetId: preset?.name ?? null,
		displayName: preset?.name ?? 'Custom',
		manifestNote: preset?.note ?? ''
	};
}

export function rankArrays(
	names: string[],
	z: Float64Array[],
	sigmaZ: number[][],
	weights: number[]
): { order: Int32Array; scores: Float64Array; denominator: number; rankByIndex: Int32Array } {
	const count = names.length;
	const denom = denominator(weights, sigmaZ);
	const scores = new Float64Array(count);
	for (let feature = 0; feature < weights.length; feature++) {
		const coefficient = weights[feature] / denom;
		if (coefficient === 0) continue;
		const column = z[feature];
		for (let index = 0; index < count; index++) scores[index] += coefficient * column[index];
	}
	const order = new Int32Array(count);
	for (let index = 0; index < count; index++) order[index] = index;
	order.sort(
		(a, b) => scores[b] - scores[a] || (names[a] < names[b] ? -1 : names[a] > names[b] ? 1 : a - b)
	);
	const rankByIndex = new Int32Array(count);
	for (let position = 0; position < count; position++) rankByIndex[order[position]] = position + 1;
	return { order, scores, denominator: denom, rankByIndex };
}

export function computeRanking(input: RankingEngineInput): RankingResult {
	const { population, sigmaZ, selectedIndex, revision, settledPreset } = input;
	const weights = input.weights.slice();
	const ranking = rankArrays(population.names, population.z, sigmaZ, weights);
	const topN = Math.max(1, Math.min(input.topN, population.count));
	const top250 = ranking.order.slice(0, Math.min(250, population.count));
	const bucket = new Uint8Array(population.count);
	for (let index = 0; index < population.count; index++) {
		const place = ranking.rankByIndex[index];
		bucket[index] = place <= topN ? 3 : place <= 50 ? 2 : place <= 250 ? 1 : 0;
	}
	const scoreIndicesList = Array.from(ranking.order.slice(0, topN));
	if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < population.count) {
		if (!scoreIndicesList.includes(selectedIndex)) scoreIndicesList.push(selectedIndex);
	}
	const scoreIndices = Int32Array.from(scoreIndicesList);
	const scoreValues = Float64Array.from(scoreIndicesList.map((index) => ranking.scores[index]));
	const contributionValues = new Float64Array(scoreIndicesList.length * weights.length);
	for (let position = 0; position < scoreIndicesList.length; position++) {
		const values = contributions(
			population,
			scoreIndicesList[position],
			weights,
			ranking.denominator
		);
		contributionValues.set(values, position * weights.length);
	}
	const selectedContributions =
		selectedIndex !== null && selectedIndex >= 0 && selectedIndex < population.count
			? Float64Array.from(contributions(population, selectedIndex, weights, ranking.denominator))
			: null;
	return {
		revision,
		lens: rankingLensSnapshot(weights, settledPreset),
		weights,
		denominator: ranking.denominator,
		top250,
		rankByIndex: ranking.rankByIndex,
		scoreIndices,
		scoreValues,
		contributionValues,
		rankBuckets: bucket,
		selectedIndex,
		selectedContributions,
		topN
	};
}

export function scoreFor(result: RankingResult, index: number): number | null {
	const position = result.scoreIndices.indexOf(index);
	return position >= 0 ? result.scoreValues[position] : null;
}

export function contributionsFor(result: RankingResult, index: number): number[] | null {
	const position = result.scoreIndices.indexOf(index);
	if (position < 0) return null;
	const width = result.weights.length;
	return Array.from(result.contributionValues.slice(position * width, (position + 1) * width));
}

export function cloneRankingResult(result: RankingResult): RankingResult {
	return {
		...result,
		lens: {
			...result.lens,
			weights: result.lens.weights.slice(),
			displayShares: result.lens.displayShares.slice()
		},
		weights: result.weights.slice(),
		top250: new Int32Array(result.top250),
		rankByIndex: new Int32Array(result.rankByIndex),
		scoreIndices: new Int32Array(result.scoreIndices),
		scoreValues: new Float64Array(result.scoreValues),
		contributionValues: new Float64Array(result.contributionValues),
		rankBuckets: new Uint8Array(result.rankBuckets),
		selectedContributions: result.selectedContributions
			? new Float64Array(result.selectedContributions)
			: null
	};
}
