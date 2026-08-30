import type { ContributionSegment } from './presentation';

export const CONTRIBUTION_ZERO_TOLERANCE = 1e-9;

export interface ContributionVisualSegment extends ContributionSegment {
	/** Normalised composition width, from 0 to 100. */
	width: number;
	sign: 'negative' | 'positive' | 'zero';
}

export interface ContributionComposition {
	/** Negative segments, zero-width features, then positive segments. */
	segments: ContributionVisualSegment[];
	/** The mathematical zero boundary, even when the divider is hidden for one-sided values. */
	zeroBoundary: number | null;
	totalMagnitude: number;
	hasNegative: boolean;
	hasPositive: boolean;
	allZero: boolean;
}

/**
 * Turn signed feature contributions into a full-width diverging composition bar.
 *
 * The input order is the manifest order. Negative and positive values are grouped around the
 * zero boundary without changing their order within either group. Zero values stay in the
 * returned model with width zero so the on-demand value view can still enumerate every feature.
 */
export function calculateContributionComposition(
	input: ContributionSegment[],
	zeroTolerance = CONTRIBUTION_ZERO_TOLERANCE
): ContributionComposition {
	const safe = input.map((segment) => ({
		...segment,
		value: Number.isFinite(segment.value) ? segment.value : 0
	}));
	const negative = safe.filter((segment) => segment.value < -zeroTolerance);
	const positive = safe.filter((segment) => segment.value > zeroTolerance);
	const zero = safe.filter(
		(segment) => segment.value >= -zeroTolerance && segment.value <= zeroTolerance
	);
	const totalMagnitude = safe.reduce(
		(sum, segment) => sum + (Math.abs(segment.value) > zeroTolerance ? Math.abs(segment.value) : 0),
		0
	);
	const hasNegative = negative.length > 0;
	const hasPositive = positive.length > 0;
	if (!(totalMagnitude > 0)) {
		return {
			segments: safe.map((segment) => ({ ...segment, width: 0, sign: 'zero' })),
			zeroBoundary: null,
			totalMagnitude: 0,
			hasNegative: false,
			hasPositive: false,
			allZero: true
		};
	}

	const ordered = [
		...negative.map((segment) => ({ segment, sign: 'negative' as const })),
		...zero.map((segment) => ({ segment, sign: 'zero' as const })),
		...positive.map((segment) => ({ segment, sign: 'positive' as const }))
	];
	const lastVisualIndex = ordered.reduce(
		(last, item, index) => (item.sign === 'zero' ? last : index),
		-1
	);
	let consumed = 0;
	const segments = ordered.map(({ segment, sign }, index) => {
		if (sign === 'zero') return { ...segment, width: 0, sign };
		const rawWidth = (Math.abs(segment.value) / totalMagnitude) * 100;
		const width = index === lastVisualIndex ? Math.max(0, 100 - consumed) : rawWidth;
		consumed += width;
		return { ...segment, width, sign };
	});
	return {
		segments,
		zeroBoundary:
			(negative.reduce((sum, segment) => sum + Math.abs(segment.value), 0) / totalMagnitude) * 100,
		totalMagnitude,
		hasNegative,
		hasPositive,
		allZero: false
	};
}
