import { ProminenceFormatError, type Population } from './types';

export const STANDING_FEATURES = ['regard', 'reach', 'recognition'] as const;
export type StandingFeature = (typeof STANDING_FEATURES)[number];

export interface DimensionStandings {
	/** One 1-based deterministic rank array per manifest feature key. */
	byFeature: Record<StandingFeature, Int32Array>;
}

function rankFeature(population: Population, featureIndex: number): Int32Array {
	const order = new Int32Array(population.count);
	for (let index = 0; index < population.count; index++) order[index] = index;
	const values = population.z[featureIndex];
	order.sort(
		(a, b) =>
			values[b] - values[a] ||
			(population.names[a] < population.names[b]
				? -1
				: population.names[a] > population.names[b]
					? 1
					: a - b)
	);
	const ranks = new Int32Array(population.count);
	for (let position = 0; position < order.length; position++) ranks[order[position]] = position + 1;
	return ranks;
}

/**
 * Calculate each static dimension ranking once from the transported z-values.
 * `featureOrder` is the manifest order; the result is keyed semantically so the UI can
 * preserve that order without confusing a reordered artifact with a different dimension.
 */
export function computeDimensionStandings(
	population: Population,
	featureOrder: readonly string[] = STANDING_FEATURES
): DimensionStandings {
	const indices = STANDING_FEATURES.map((feature) => featureOrder.indexOf(feature));
	if (indices.some((index) => index < 0) || new Set(indices).size !== STANDING_FEATURES.length)
		throw new ProminenceFormatError('Dimension standings require regard, reach, and recognition.');
	return {
		byFeature: {
			regard: rankFeature(population, indices[0]),
			reach: rankFeature(population, indices[1]),
			recognition: rankFeature(population, indices[2])
		}
	};
}

/** Return only exceptional percentile labels, conservatively rounded down by exact rank. */
export function standingPercentileBadge(rank: number, populationCount: number): string | null {
	if (
		!Number.isInteger(rank) ||
		rank < 1 ||
		!Number.isInteger(populationCount) ||
		populationCount < 1
	)
		return null;
	if (rank <= populationCount * 0.001) return 'Top 0.1%';
	if (rank <= populationCount * 0.01) return 'Top 1%';
	if (rank <= populationCount * 0.05) return 'Top 5%';
	if (rank <= populationCount * 0.1) return 'Top 10%';
	return null;
}
