import { MIN_RAW_VARIANCE, rawVariance } from './score';
import { ProminenceFormatError, ProminenceScoringError } from './types';

/** The release gate is deliberately stricter than the runtime scoring gate. */
export const RELEASE_VARIANCE_MARGIN_MULTIPLIER = 100;
export const RELEASE_MIN_RAW_VARIANCE = MIN_RAW_VARIANCE * RELEASE_VARIANCE_MARGIN_MULTIPLIER;

/** Numerical tolerance for clipping a stationary point back onto a simplex face. */
export const SIMPLEX_NEGATIVE_TOLERANCE = 1e-10;

export interface SimplexMinimum {
	variance: number;
	weights: number[];
	activeIndices: number[];
}

interface LinearSolveResult {
	solution: number[];
}

function solvePositiveDefinite(
	matrix: number[][],
	rightHandSide: number[]
): LinearSolveResult | null {
	const size = matrix.length;
	const lower = Array.from({ length: size }, () => new Array<number>(size).fill(0));
	const scale = Math.max(
		1,
		...matrix.map((row) => row.reduce((sum, value) => sum + Math.abs(value), 0))
	);
	const tolerance = Number.EPSILON * scale * Math.max(4, size * size);

	// Cholesky factorisation plus forward/back substitution. This solves Sigma*x=1
	// without forming an inverse, which is both more stable and cheaper for these faces.
	for (let row = 0; row < size; row++) {
		for (let column = 0; column <= row; column++) {
			let value = matrix[row][column];
			for (let previous = 0; previous < column; previous++) {
				value -= lower[row][previous] * lower[column][previous];
			}
			if (row === column) {
				if (!(value > tolerance) || !Number.isFinite(value)) return null;
				lower[row][column] = Math.sqrt(value);
			} else {
				const pivot = lower[column][column];
				if (!(pivot > tolerance)) return null;
				lower[row][column] = value / pivot;
			}
		}
	}

	const forward = new Array<number>(size).fill(0);
	for (let row = 0; row < size; row++) {
		let value = rightHandSide[row];
		for (let previous = 0; previous < row; previous++) {
			value -= lower[row][previous] * forward[previous];
		}
		forward[row] = value / lower[row][row];
	}
	const solution = new Array<number>(size).fill(0);
	for (let row = size - 1; row >= 0; row--) {
		let value = forward[row];
		for (let next = row + 1; next < size; next++) {
			value -= lower[next][row] * solution[next];
		}
		solution[row] = value / lower[row][row];
	}
	return { solution };
}

/**
 * Find the exact minimum of wᵀΣw on the non-negative, sum-one simplex.
 *
 * Every non-empty active set is solved as its own equality-constrained quadratic
 * problem. A candidate with a materially negative active weight is not a point on
 * that face and is discarded; a tiny round-off negative is clipped and renormalised.
 * With three features this is the seven vertices/edges/interior candidates required
 * by the release contract.
 */
export function minimumSimplexRawVariance(sigmaZ: number[][]): SimplexMinimum | null {
	const featureCount = sigmaZ.length;
	if (featureCount === 0 || featureCount > 20) return null;

	let best: SimplexMinimum | null = null;
	const subsetCount = 1 << featureCount;
	for (let mask = 1; mask < subsetCount; mask++) {
		const activeIndices: number[] = [];
		for (let index = 0; index < featureCount; index++) {
			if (mask & (1 << index)) activeIndices.push(index);
		}
		const submatrix = activeIndices.map((row) =>
			activeIndices.map((column) => sigmaZ[row]?.[column] ?? Number.NaN)
		);
		const solved = solvePositiveDefinite(
			submatrix,
			new Array<number>(activeIndices.length).fill(1)
		);
		if (!solved) continue;
		const normaliser = solved.solution.reduce((sum, value) => sum + value, 0);
		if (!(normaliser > 0) || !Number.isFinite(normaliser)) continue;

		const candidate = new Array<number>(featureCount).fill(0);
		let valid = true;
		for (let position = 0; position < activeIndices.length; position++) {
			const value = solved.solution[position] / normaliser;
			if (!Number.isFinite(value) || value < -SIMPLEX_NEGATIVE_TOLERANCE) {
				valid = false;
				break;
			}
			candidate[activeIndices[position]] = Math.max(0, value);
		}
		if (!valid) continue;
		const total = candidate.reduce((sum, value) => sum + value, 0);
		if (!(total > 0) || !Number.isFinite(total)) continue;
		for (let index = 0; index < featureCount; index++) candidate[index] /= total;
		const variance = rawVariance(candidate, sigmaZ);
		if (!Number.isFinite(variance)) continue;
		if (!best || variance < best.variance) {
			best = { variance, weights: candidate, activeIndices: activeIndices.slice() };
		}
	}
	return best;
}

/** Validate one lens at the request boundary before it reaches the ranking engine. */
export function validateLensWeights(
	weights: unknown,
	sigmaZ: number[][],
	featureCount = sigmaZ.length,
	minimumVariance = MIN_RAW_VARIANCE
): asserts weights is number[] {
	if (
		!Array.isArray(weights) ||
		weights.length !== featureCount ||
		!weights.every((value) => typeof value === 'number' && Number.isFinite(value))
	) {
		throw new ProminenceScoringError(`A lens must contain ${featureCount} finite weights.`);
	}
	if (weights.some((value) => value < 0)) {
		throw new ProminenceScoringError('A lens cannot contain negative weights.');
	}
	const total = weights.reduce((sum, value) => sum + value, 0);
	if (!Number.isFinite(total) || Math.abs(total - 1) > 1e-6) {
		throw new ProminenceScoringError('A lens must contain nonnegative weights that sum to 1.');
	}
	const variance = rawVariance(weights, sigmaZ);
	if (!Number.isFinite(variance) || variance <= minimumVariance) {
		throw new ProminenceScoringError(
			`A lens has unusable raw variance; it must be greater than ${minimumVariance}.`
		);
	}
}

/** Non-throwing form for URL parsing and other untrusted input boundaries. */
export function isUsableLensWeights(
	weights: unknown,
	sigmaZ: number[][],
	featureCount = sigmaZ.length,
	minimumVariance = MIN_RAW_VARIANCE
): weights is number[] {
	try {
		validateLensWeights(weights, sigmaZ, featureCount, minimumVariance);
		return true;
	} catch (error) {
		if (!(error instanceof ProminenceScoringError)) throw error;
		return false;
	}
}

/** Validate the whole release simplex before any ranking worker is created. */
export function validateReleaseSimplex(sigmaZ: number[][]): SimplexMinimum {
	const minimum = minimumSimplexRawVariance(sigmaZ);
	if (!minimum || !Number.isFinite(minimum.variance)) {
		throw new ProminenceFormatError(
			'The release has no finite valid lens across its weight simplex.'
		);
	}
	if (minimum.variance <= RELEASE_MIN_RAW_VARIANCE) {
		throw new ProminenceFormatError(
			`The release contains an unsafe lens: simplex minimum raw variance ${minimum.variance} must be greater than ${RELEASE_MIN_RAW_VARIANCE}.`
		);
	}
	return minimum;
}
