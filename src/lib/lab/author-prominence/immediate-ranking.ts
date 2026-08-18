import { contributions, denominator } from './score';
import type { Population } from './types';

export interface ImmediateAuthorMetrics {
	index: number;
	score: number;
	values: number[];
}

export interface ImmediateSelectedMetrics extends ImmediateAuthorMetrics {
	/** Exact 1-based rank using the release's score/name/index tie contract. */
	place: number;
}

export interface ImmediateRankingMetrics {
	denominator: number;
	/** Metrics for the small set of authors currently visible in the UI. */
	byIndex: Map<number, ImmediateAuthorMetrics>;
	selected: ImmediateSelectedMetrics | null;
	/** Shared contribution scale for the visible rows and selected author. */
	barScale: number;
}

export interface ImmediateSelectedRanking {
	denominator: number;
	selected: ImmediateSelectedMetrics | null;
}

export interface ImmediateRankingInput {
	population: Population;
	sigmaZ: number[][];
	weights: number[];
	visibleIndices: ArrayLike<number>;
	selectedIndex: number | null;
}

export interface ImmediateSelectedRankingInput {
	population: Population;
	sigmaZ: number[][];
	weights: number[];
	selectedIndex: number | null;
}

export interface ImmediateVisibleRankingInput {
	population: Population;
	weights: number[];
	denominator: number;
	visibleIndices: ArrayLike<number>;
	selected: ImmediateSelectedMetrics | null;
}

function scoreAt(population: Population, index: number, coefficients: number[]): number {
	let score = 0;
	for (let feature = 0; feature < coefficients.length; feature++) {
		score += coefficients[feature] * population.z[feature][index];
	}
	return score;
}

function validIndex(population: Population, index: number): boolean {
	return index >= 0 && index < population.count;
}

/**
 * Calculate the selected author's score and exact rank without sorting the population.
 *
 * This is the only immediate calculation that scans every author. It intentionally has no
 * population-wide score array or sort, and uses the same coefficient order and name/index tie
 * break as the authoritative ranking engine.
 */
export function calculateImmediateSelectedRanking({
	population,
	sigmaZ,
	weights,
	selectedIndex
}: ImmediateSelectedRankingInput): ImmediateSelectedRanking {
	const denominatorValue = denominator(weights, sigmaZ);
	if (selectedIndex === null || !validIndex(population, selectedIndex)) {
		return { denominator: denominatorValue, selected: null };
	}

	const coefficients = weights.map((weight) => weight / denominatorValue);
	const selectedScore = scoreAt(population, selectedIndex, coefficients);
	const selectedMetric: ImmediateAuthorMetrics = {
		index: selectedIndex,
		score: selectedScore,
		values: contributions(population, selectedIndex, weights, denominatorValue)
	};

	let place = 1;
	const selectedName = population.names[selectedIndex];
	for (let index = 0; index < population.count; index++) {
		if (index === selectedIndex) continue;
		const score = scoreAt(population, index, coefficients);
		if (
			score > selectedScore ||
			(score === selectedScore &&
				(population.names[index] < selectedName ||
					(population.names[index] === selectedName && index < selectedIndex)))
		) {
			place += 1;
		}
	}

	return {
		denominator: denominatorValue,
		selected: { ...selectedMetric, place }
	};
}

/**
 * Recalculate only the visible contribution slice for a known denominator and selected metric.
 * Ranking-result publication can therefore change the visible order without repeating the
 * release-sized selected-author scan.
 */
export function calculateImmediateVisibleRanking({
	population,
	weights,
	denominator: denominatorValue,
	visibleIndices,
	selected
}: ImmediateVisibleRankingInput): ImmediateRankingMetrics {
	const coefficients = weights.map((weight) => weight / denominatorValue);
	const byIndex = new Map<number, ImmediateAuthorMetrics>();
	const add = (index: number): void => {
		if (!validIndex(population, index) || byIndex.has(index)) return;
		byIndex.set(index, {
			index,
			score: scoreAt(population, index, coefficients),
			values: contributions(population, index, weights, denominatorValue)
		});
	};

	for (let position = 0; position < visibleIndices.length; position++)
		add(visibleIndices[position]);
	if (selected) byIndex.set(selected.index, selected);

	let largestContribution = 0;
	for (const metric of byIndex.values()) {
		for (const value of metric.values)
			largestContribution = Math.max(largestContribution, Math.abs(value));
	}

	return {
		denominator: denominatorValue,
		byIndex,
		selected,
		barScale: largestContribution > 0 ? largestContribution : 1
	};
}

/**
 * Calculate the small, synchronous presentation slice needed while the worker catches up.
 *
 * This convenience function combines the selected-author scan and visible contribution slice.
 * The page keeps those phases cached independently so ranking publication does not repeat the
 * population scan when only the worker-owned visible order changes.
 */
export function calculateImmediateRanking({
	population,
	sigmaZ,
	weights,
	visibleIndices,
	selectedIndex
}: ImmediateRankingInput): ImmediateRankingMetrics {
	const selectedRanking = calculateImmediateSelectedRanking({
		population,
		sigmaZ,
		weights,
		selectedIndex
	});
	return calculateImmediateVisibleRanking({
		population,
		weights,
		denominator: selectedRanking.denominator,
		visibleIndices,
		selected: selectedRanking.selected
	});
}
