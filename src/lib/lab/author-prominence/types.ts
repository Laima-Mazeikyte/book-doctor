/** Types for the author-prominence artifact release (manifest schema_version 1). */

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
		tier_weights: number[];
		gate: {
			min_books: number;
			min_clean_likes: number;
		};
	};
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
		folds: number;
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
	/** Stable artifact IDs when supplied; schema 1 intentionally falls back to names. */
	authorIds: string[] | null;
	/** Feature z-scores, one array per manifest feature, in `features` order. */
	z: Float64Array[];
	hasRecognition: Uint8Array;
	nBooks: Int32Array;
	nReaders: Int32Array;
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
