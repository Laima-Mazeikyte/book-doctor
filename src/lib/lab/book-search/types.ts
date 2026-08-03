/** Types for the versioned book-ranking handoff. */

export const RANKING_MODES = [
	'best_books',
	'best_series',
	'polarizing_books',
	'polarizing_series'
] as const;

export type RankingMode = (typeof RANKING_MODES)[number];

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
	settled: boolean;
	reach_share?: number;
}

export interface BookRankingManifest {
	schema_version: number;
	generated_utc: string;
	version: string;
	display: {
		top_n: number;
	};
	datasets: Record<RankingMode, string>;
	model: Record<RankingMode, RankingModel>;
	presets: Record<RankingMode, RankingPreset[]>;
	disclosure: {
		headline: string;
		items: string[];
	};
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
	itemIds: string[];
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
	scores: Float64Array;
	statisticalScores: Float64Array;
	contributions: Float64Array[];
	denominator: number;
	reachShare: number;
}
