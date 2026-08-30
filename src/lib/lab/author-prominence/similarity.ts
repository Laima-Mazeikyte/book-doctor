import { ProminenceFormatError, type Population } from './types';
import { STANDING_FEATURES } from './standings';

export interface SimilarityProfile {
	index: number;
	distance: number;
}

export interface SimilarityInput {
	population: Population;
	sigmaZ: number[][];
	selectedIndex: number;
	featureOrder?: readonly string[];
	limit?: number;
}

function invertMatrix(matrix: number[][]): number[][] {
	const size = matrix.length;
	if (
		!size ||
		matrix.some((row) => row.length !== size || row.some((value) => !Number.isFinite(value)))
	)
		throw new ProminenceFormatError('Similarity covariance must be a finite square matrix.');
	const augmented = matrix.map((row, rowIndex) => [
		...row,
		...Array.from({ length: size }, (_, column) => (column === rowIndex ? 1 : 0))
	]);
	for (let column = 0; column < size; column++) {
		let pivotRow = column;
		for (let row = column + 1; row < size; row++) {
			if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
		}
		const pivot = augmented[pivotRow][column];
		if (!Number.isFinite(pivot) || Math.abs(pivot) <= 1e-14)
			throw new ProminenceFormatError('Similarity covariance is singular.');
		if (pivotRow !== column)
			[augmented[pivotRow], augmented[column]] = [augmented[column], augmented[pivotRow]];
		const divisor = augmented[column][column];
		for (let cell = 0; cell < size * 2; cell++) augmented[column][cell] /= divisor;
		for (let row = 0; row < size; row++) {
			if (row === column) continue;
			const factor = augmented[row][column];
			if (factor === 0) continue;
			for (let cell = 0; cell < size * 2; cell++)
				augmented[row][cell] -= factor * augmented[column][cell];
		}
	}
	return augmented.map((row) => row.slice(size));
}

function quadraticForm(vector: number[], matrix: number[][]): number {
	let total = 0;
	for (let row = 0; row < vector.length; row++) {
		for (let column = 0; column < vector.length; column++)
			total += vector[row] * matrix[row][column] * vector[column];
	}
	return total;
}

/**
 * Find the closest three prominence profiles in regard/reach/recognition space.
 * The active lens is deliberately absent from this input and therefore cannot affect the
 * result.
 */
export function calculateSimilarProfiles({
	population,
	sigmaZ,
	selectedIndex,
	featureOrder = STANDING_FEATURES,
	limit = 3
}: SimilarityInput): SimilarityProfile[] {
	if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= population.count)
		return [];
	if (!Number.isInteger(limit) || limit <= 0) return [];
	const featureIndices = STANDING_FEATURES.map((feature) => featureOrder.indexOf(feature));
	if (featureIndices.some((index) => index < 0))
		throw new ProminenceFormatError('Similarity requires regard, reach, and recognition features.');
	const covariance = featureIndices.map((row) =>
		featureIndices.map((column) => sigmaZ[row]?.[column] ?? Number.NaN)
	);
	const inverse = invertMatrix(covariance);
	const selected = featureIndices.map((featureIndex) => population.z[featureIndex][selectedIndex]);
	const profiles: SimilarityProfile[] = [];
	for (let index = 0; index < population.count; index++) {
		if (index === selectedIndex) continue;
		const difference = featureIndices.map(
			(featureIndex, dimension) => population.z[featureIndex][index] - selected[dimension]
		);
		const squared = quadraticForm(difference, inverse);
		if (!Number.isFinite(squared)) continue;
		profiles.push({ index, distance: Math.sqrt(Math.max(0, squared)) });
	}
	profiles.sort(
		(a, b) =>
			a.distance - b.distance ||
			(population.names[a.index] < population.names[b.index]
				? -1
				: population.names[a.index] > population.names[b.index]
					? 1
					: a.index - b.index)
	);
	return profiles.slice(0, limit);
}
