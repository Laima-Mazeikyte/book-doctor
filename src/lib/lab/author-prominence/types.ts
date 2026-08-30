/** Types for the author-prominence artifact release (manifest schema_version 2). */

/** Thrown when a release is structurally unusable — wrong schema, missing columns. */
export class ProminenceFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProminenceFormatError';
	}
}

/** Thrown when a mathematically invalid scoring input reaches the ranking engine. */
export class ProminenceScoringError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProminenceScoringError';
	}
}

export interface AuditEntry<Rule> {
	badge: string;
	explain: string;
	rule: Rule;
}

/** High ratings with no awards to corroborate them. */
export interface RegardOnlyRule {
	min_regard_z: number;
}

/** Below-median ratings and little recognition; readership supplies most of the score. */
export interface ReachOnlyRule {
	max_regard_z: number;
	min_reach_z: number;
	max_recognition_z: number;
	/** Minimum share of the total positive contribution that reach must supply. */
	min_reach_share: number;
}

export interface Preset {
	name: string;
	/** In `model.features` order. */
	weights: number[];
	/** Exactly one preset is the tested default and the correct initial selection. */
	settled: boolean;
	note: string;
}

export interface AuthorIdentity {
	/** Optional durable identifier introduced by a future release schema. */
	id: string;
	name: string;
}

/** The detail-shard contract nested inside the main manifest. */
export interface ProminenceDetailManifest {
	schema_version: number;
	author_count: number;
	shard_size: number;
	shard_count: number;
	index_base: number;
	path_pattern: string;
	book_limit: number;
	recognition_record_limit: number;
	peak_method: string;
	peak_weight_quantum: number;
	generated_utc: string;
	provenance?: Record<string, string>;
}

/** Raw positional values are confined to the detail-data module. */
export type ProminenceDetailBookTuple = [bookId: string, title: string];
export type ProminenceRecognitionReceiptTuple = [
	workTitle: string,
	awardName: string,
	year: number | null,
	status: string
];
export type ProminenceRecognitionTierTuple = [
	tier: number,
	receipts: ProminenceRecognitionReceiptTuple[]
];
export type ProminenceDetailRow = [
	peakRank: number,
	peakWeights: number[],
	catalogueYears: [number, number] | null,
	genres: string[],
	books: ProminenceDetailBookTuple[],
	recognition: ProminenceRecognitionTierTuple[]
];

/** The wire shape of one detail shard. Rows are normalized before they reach components. */
export interface ProminenceDetailShard {
	schema_version: number;
	start: number;
	columns: string[];
	rows: unknown[][];
}

export interface AuthorBook {
	bookUlid: string;
	title: string;
}

export type RecognitionStatus = 'win' | 'shortlist' | 'longlist' | 'nominee' | 'honor';

export interface RecognitionReceipt {
	workTitle: string;
	awardName: string;
	year: number | null;
	status: string;
	tier: number;
}

/** Positional detail rows become this stable, named view model at the data boundary. */
export interface NormalizedAuthorDetail {
	populationIndex: number;
	peakRank: number;
	peakWeights: number[];
	catalogueYears: [number, number] | null;
	genres: string[];
	books: AuthorBook[];
	recognition: RecognitionReceipt[];
}

export interface NormalizedDetailShard {
	schema_version: number;
	start: number;
	rows: NormalizedAuthorDetail[];
}

export interface ProminenceManifest {
	schema_version: number;
	generated_utc: string;
	version: string;
	display: {
		top_n: number;
	};
	model: {
		/** Feature order. `sigma_z`, `default_weights` and every weight vector use it. */
		features: string[];
		feature_labels: Record<string, string>;
		feature_blurbs: Record<string, string>;
		/** Correlation matrix of the normal-scored features. Required for scoring. */
		sigma_z: number[][];
		default_weights: number[];
		index_base: number;
		index_scale: number;
		/**
		 * While false, the rating-style scale is uncalibrated and must not be rendered.
		 * See `formatScore` in `score.ts`.
		 */
		index_is_calibrated_elo: boolean;
		mode: string;
		/** Optional provenance; the scored recognition values are already materialized. */
		tier_weights?: number[];
		/** Optional eligibility provenance; the release disclosure remains authoritative copy. */
		gate?: {
			min_books?: number;
		};
	};
	details: ProminenceDetailManifest;
	presets: Preset[];
	audit: {
		regard_only: AuditEntry<RegardOnlyRule>;
		reach_only: AuditEntry<ReachOnlyRule>;
	};
	disclosure: {
		/** Load-bearing product copy, not decoration. */
		headline: string;
		items: string[];
	};
	quality: {
		eligible_authors: number;
		authors_in_source: number;
		/** Optional model-validation provenance. */
		folds?: number;
		weights_settled_by: string;
	};
}

/**
 * The ranked population in column-major form.
 *
 * Scoring touches every author on every weight change, so the hot columns are typed
 * arrays rather than 11,950 objects. Descriptive columns are read only for whichever
 * handful of authors is on screen.
 */
export interface Population {
	count: number;
	names: string[];
	/** Stable artifact IDs when supplied; v2 intentionally falls back to names when absent. */
	authorIds: string[] | null;
	/** Feature z-scores, one array per manifest feature, in `features` order. */
	z: Float64Array[];
	hasRecognition: Uint8Array;
	nBooks: Int32Array;
	/** Best effective award tier, 1 (most selective) to 5. `0` stands for "none recorded". */
	bestTier: Int8Array;
	/** Total awards across all tiers — not the count at `bestTier`. */
	nAwards: Int32Array;
	/** Descriptive only; never enters the score. `NaN` when the release omits it. */
	concentration: Float64Array;
}

/** One author's per-feature contributions, in `features` order. These sum to the score. */
export type Contributions = number[];

export interface Ranking {
	/** Population indices, best first. Ties broken by name, so this is deterministic. */
	order: Int32Array;
	/** Composite score per population index. */
	scores: Float64Array;
	/** sqrt(wᵀ · sigma_z · w) — the spread-preserving denominator. */
	denominator: number;
}

export interface Badge {
	badge: string;
	explain: string;
}
