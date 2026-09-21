/** Types for the versioned book-ranking handoff. */

export const RANKING_MODES = ['best_items', 'polarizing_items'] as const;

export type RankingMode = (typeof RANKING_MODES)[number];

/** Every ranking model combines exactly three standardized features. */
export const FEATURE_COUNT = 3;

export class BookRankingFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BookRankingFormatError';
	}
}

export interface RankingModel {
	features: string[];
	sigma_z: number[][];
	default_weights: number[];
	default_reach_share?: number;
}

export interface RankingPreset {
	name: string;
	weights: number[];
	reach_share?: number;
}

export interface BookRankingManifest {
	schema_version: number;
	version: string;
	datasets: Record<RankingMode, string>;
	model: Record<RankingMode, RankingModel>;
	presets: Record<RankingMode, RankingPreset[]>;
	quality: {
		items: Record<RankingMode, number>;
	};
}

export interface RankingPayload {
	columns: string[];
	rows: unknown[][];
}

/** Column-major representation keeps repeated slider scoring cheap. */
export interface BookPopulation {
	mode: RankingMode;
	count: number;
	itemTypes: Array<'book' | 'series'>;
	titles: string[];
	authors: string[];
	seriesNames: Array<string | null>;
	constituentBookIds: string[][];
	z: Float64Array[];
	/** Reach z-scores used only by the cultural-polarization blend. */
	culturalReachZ: Float64Array | null;
}

export interface BookRanking {
	order: Int32Array;
	/** One-based rank by population index, for constant-time row rendering. */
	places: Int32Array;
	/** Weighted z-score; for polarization, the reach blend mapped back onto the z scale. */
	scores: Float64Array;
}
