/**
 * Types for the author taste release (`manifest.schema_version` 3, `paired-evidence-*`).
 *
 * This is a different artifact family from the retired `author_graph` release, and its
 * `schema_version` numbering is unrelated — do not read 4 → 3 as a downgrade. The two are
 * distinguished by `created_by`, which `release.ts` checks.
 *
 * The defining difference: selection and directionality are decided upstream. The artifact
 * ships finished estimates — rate differences, confidence intervals, evidence scores,
 * q-values — for both directions of every retained pair, plus an authoritative
 * directionality class. The frontend presents those numbers; it never re-derives them and
 * never re-thresholds them.
 */

export interface AuthorTasteManifest {
	schema_version: number;
	version: string;
	created_by: string;
	sources: {
		author_graph_version: string;
		map_version: string;
		score_validation_version: string;
	};
	selection: {
		global_directed_fdr_alpha: number;
		confidence_interval_excludes_zero: boolean;
		min_abs_rate_difference: number;
		empirical_bayes_score_floor: number;
		tau_squared: number;
		score_formula: string;
	};
	directionality: {
		method: string;
		minimum_discovery_selection_folds: number;
		forward_rate_difference_margin: number;
		reverse_equivalence_margin: number;
		fdr_alpha: number;
		literal_zero_claimed: boolean;
		statuses: string[];
	};
	authors: {
		path: string;
		columns: string[];
		row_count: number;
		author_id_encoding: string;
		map_state_codes: Record<string, string>;
		coordinate_decimals: number;
		unassigned_community_id: number;
		unassigned_color: string;
		dominant_genres: string[];
		dominant_genre_palette: Record<string, string>;
	};
	map: {
		distance_contract: string;
		/**
		 * How the two community levels were produced and how much was withheld. Communities and
		 * subcommunities below `minimum_display_size` are suppressed to `-1` in the public author
		 * rows, so the displayed counts do not add up to the detected ones — that is expected.
		 */
		community_annotations: {
			minimum_display_size: number;
			top_level_resolution: number;
			subcommunity_resolution: number;
			detected_community_count: number;
			displayed_community_count: number;
			suppressed_community_count: number;
			displayed_subcommunity_count: number;
			suppressed_subcommunity_count: number;
			curated_label_method: string;
			subcommunity_label_method: string;
			/** True — labels and ids mean nothing outside this release and must not be persisted. */
			labels_are_release_scoped: boolean;
		};
		render_edges: {
			path: string;
			columns: string[];
			render_positive_count: number;
			render_negative_count: number;
			render_count: number;
			/** False — the render layer is a sparse explanation, not the fitted geometry. */
			complete_geometry: boolean;
			/** Shared semantics for every row, now that the layer has no sign column. */
			edge_semantics?: string;
		};
		full_edges: {
			path: string;
			row_count: number;
			/** False for this release; the site must not fetch the 4.7 MB full graph. */
			loaded_on_initial_view: boolean;
		};
	};
	connections: {
		path_pattern: string;
		magic: string;
		header_bytes: number;
		record_size_bytes: number;
		bucket_count: number;
		indexed_author_count: number;
		record_count: number;
		status_codes_relative_to_shard_author: Record<string, number>;
		record_fields: { name: string; numpy_type: string; offset: number }[];
	};
	quality: {
		author_count: number;
		pair_count: number;
		selected_direction_count: number;
		directionality_status_counts: Record<string, number>;
	};
}

/**
 * `map_state` column. Only `MAPPED` authors carry coordinates; every other state has
 * `null` for x/y/z and cannot be drawn. Distinct from having connection evidence — see
 * `Author.hasConnections`.
 */
export const MAP_STATE_INSUFFICIENT = 0;
export const MAP_STATE_ELIGIBLE_NO_EDGES = 1;
export const MAP_STATE_SIGNIFICANT_UNASSIGNED = 2;
export const MAP_STATE_DISCONNECTED = 3;
export const MAP_STATE_MAPPED = 4;

/**
 * `status` on a connection record, oriented relative to the author whose block it was
 * decoded from. The artifact's own `directionality_status` uses a/b naming; the packed
 * per-endpoint form uses self/other, which is what the frontend consumes.
 *
 * The README is explicit that this field is authoritative: one-sidedness must never be
 * inferred from an absent or below-threshold reverse direction.
 */
export const STATUS_UNRESOLVED = 0;
export const STATUS_RECIPROCAL = 1;
export const STATUS_ONE_SIDED_SELF_TO_OTHER = 2;
export const STATUS_ONE_SIDED_OTHER_TO_SELF = 3;
export const STATUS_OPPOSING = 4;

export type DirectionalityStatus = 0 | 1 | 2 | 3 | 4;

/** Copy keys under `lab.authorConnections.status`, indexed by status code. */
export const STATUS_KEYS = [
	'unresolved',
	'reciprocal',
	'oneSidedOut',
	'oneSidedIn',
	'opposing'
] as const;

export interface Author {
	/** Zero-based row index in `authors.json`. The artifact guarantees `id === row index`. */
	id: number;
	name: string;
	/** Null unless `mapState === MAP_STATE_MAPPED`. */
	x: number | null;
	y: number | null;
	z: number | null;
	communityId: number;
	/**
	 * Nested community, **unique only within `communityId`** — the identity of a subcommunity
	 * is the pair, never this number alone. `-1` when the author's child group fell below the
	 * release's display floor.
	 */
	subcommunityId: number;
	mapState: number;
	bookCount: number;
	genre: string;
	connectionPairCount: number;
	selectedOutDegree: number;
	selectedInDegree: number;
	reliableOneSidedOutDegree: number;
	reliableOneSidedInDegree: number;
	sampleTitles: string[];
	/** Locates this author's block inside its connection bucket; null when it has none. */
	connectionBucket: number | null;
	connectionOffset: number | null;
	connectionBytes: number | null;
	/** Lowercased, punctuation-normalised name for search. */
	searchKey: string;
}

/** An author the map can actually draw. Satisfies the camera's `Point3D` structurally. */
export type MappedAuthor = Author & { x: number; y: number; z: number };

/** True when the author has coordinates and can be drawn. */
export function isMapped(author: Author): author is MappedAuthor {
	return author.mapState === MAP_STATE_MAPPED && author.x !== null;
}

/** True when a connection block exists to fetch. Independent of `isMapped`. */
export function hasConnections(author: Author): boolean {
	return author.connectionBucket !== null && (author.connectionBytes ?? 0) > 0;
}

/**
 * A published top-level community.
 *
 * Labels are **release-scoped**: they are generated per release from genre composition and
 * carry no meaning outside it, so they must never be persisted, deep-linked, or compared
 * against another release's labels. Communities below the display floor are absent here and
 * their authors carry `communityId === -1`.
 */
export interface Community {
	id: number;
	size: number;
	label: string;
	/** Broad genres the curated label was built from. */
	labelComponents: string[];
	dominantGenre: string;
	dominantGenreFraction: number;
	representativeAuthors: string[];
	color: string;
}

/** One genre's share of a subcommunity, strongest first. */
export interface GenreShare {
	genre: string;
	count: number;
	fraction: number;
}

/**
 * A nested community, identified by the `(communityId, id)` pair. Release-scoped in the same
 * way as `Community`. Takes its colour from its parent — the split is a refinement of one
 * community, not a separate region of the map.
 */
export interface Subcommunity {
	communityId: number;
	id: number;
	size: number;
	label: string;
	labelComponents: string[];
	parentLabel: string;
	genreComposition: GenreShare[];
	representativeAuthors: string[];
}

/** Stable key for the only thing that identifies a subcommunity: its pair. */
export function subcommunityKey(communityId: number, subcommunityId: number): string {
	return `${communityId}:${subcommunityId}`;
}

/** One direction's finished estimate, as shipped. Nothing here is computed client-side. */
export interface DirectionEstimate {
	/** Did this direction pass the upstream selection rule? */
	selected: boolean;
	/**
	 * Discovery folds, out of five, in which **this direction** was selected.
	 *
	 * Oriented, and each record stores it only for its own `self → other` direction — so the
	 * reverse reads `null` until `comparePair` recovers it from the partner's copy. Measured
	 * against the release the two copies disagree for every one-sided pair, so treating this
	 * as a property of the pair prints "selected in 0 of 5 folds" beside a one-way verdict.
	 */
	selectionFoldCount: number | null;
	/** Difference in like rate, as a proportion (0.05 = 5 percentage points). */
	rateDifference: number;
	ciLower: number;
	ciUpper: number;
	logOddsRatio: number;
	/** Empirical-Bayes shrunken effect floored at zero; the upstream ranking quantity. */
	evidenceScore: number;
	negLog10Q: number;
	likeRate: number;
	baselineRate: number;
}

/**
 * The tested gap between the two directions — a shipped estimate with its own interval,
 * not a subtraction of the two rate differences.
 */
export interface AsymmetryEstimate {
	difference: number;
	ciLower: number;
	ciUpper: number;
	negLog10Q: number;
}

/**
 * One incident pair record, oriented relative to the author whose block it came from.
 *
 * Both directions live in a single record, so comparing two authors needs one bucket fetch
 * rather than two.
 */
export interface ConnectionRecord {
	otherId: number;
	/** Unordered pair identity; joins to `analysis/connection_pairs.parquet`. */
	pairId: number;
	status: DirectionalityStatus;
	/** Sign of the self → other direction. */
	selfSign: number;
	self: DirectionEstimate;
	reverse: DirectionEstimate;
	/**
	 * `null` when this copy of the pair does not carry the gap.
	 *
	 * The asymmetry is an estimate about an **oriented** claim, stored self → other, and the
	 * artifact populates it only on the endpoint where that is the orientation that was
	 * tested. Every `reliably_one_sided_other_to_self` record therefore carries zeros — the
	 * gap lives in the partner's copy, negated. Measured against the release: status 3 is
	 * zeroed 100% of the time and status 2 never. `comparePair` recovers it from the partner.
	 */
	asymmetry: AsymmetryEstimate | null;
}

/** A connection resolved against the author index, ready to render. */
export interface Connection {
	record: ConnectionRecord;
	other: Author;
	/**
	 * Straight-line distance between the two authors in map space, or null when either
	 * endpoint is unmapped. Proximity is suggestive context, never itself evidence.
	 */
	mapDistance: number | null;
}
