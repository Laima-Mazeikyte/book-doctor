import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';
import { ensureAnonymousSessionStarted } from '$lib/auth/anonymous-session';
import type { AsymmetryEstimate, DirectionalityStatus } from './types';

/**
 * Arbitrary two-author comparisons, computed on demand by the private backend.
 *
 * The static handoff only carries the 419,172 pairs that survived global selection — barely
 * one pair in 1,400 of the catalogue — so a reader picking two authors at random almost never
 * hit one. This function answers any pair by intersecting reader sets server-side.
 *
 * Reader memberships never leave the database. `private.compare_authors` returns aggregates
 * only, and the `private` schema is deliberately outside the Data API: this must always go
 * through the Edge Function, never through a browser table query.
 *
 * The two tiers of answer are not interchangeable and `mode` says which one this is:
 *
 * - **release** — the pair is in the release's held-out analysis, so its q-values are
 *   globally multiple-testing corrected and its directionality verdict is authoritative.
 * - **on_demand** — computed for this request. There is a p-value but `q_value` is null and
 *   nothing is corrected for the millions of pairs that could have been asked for instead.
 *   The backend also decides whether there is enough information for a usable comparison.
 */

/** Overridable so a local `supabase functions serve` can be pointed at without a rebuild. */
export const COMPARE_AUTHORS_FUNCTION =
	env.PUBLIC_AUTHOR_COMPARISON_FUNCTION?.trim() || 'compare-authors';

/** Why a direction is or is not usable, before any question of significance. */
export type EvidenceStatus =
	| 'no_comparable_readers'
	| 'below_author_thresholds'
	| 'below_pair_information'
	| 'eligible_unadjusted';

export const EVIDENCE_STATUS_KEYS: Record<EvidenceStatus, string> = {
	no_comparable_readers: 'noComparableReaders',
	below_author_thresholds: 'belowAuthorThresholds',
	below_pair_information: 'belowPairInformation',
	eligible_unadjusted: 'eligible'
};

export type ComparisonMode = 'release' | 'on_demand';

/** Backend-owned display states. The two non-validated states intentionally share visible copy. */
export type ComparisonDisplayState =
	| 'validated'
	| 'evidence_threshold_not_met'
	| 'on_demand_not_formally_validated'
	| 'not_enough_data';

export const DISPLAY_STATE_COPY_KEYS: Record<ComparisonDisplayState, string> = {
	validated: 'validated',
	evidence_threshold_not_met: 'evidenceThresholdNotMet',
	on_demand_not_formally_validated: 'onDemandNotFormallyValidated',
	not_enough_data: 'notEnoughData'
};

/** `directionality_status` as the backend spells it, mapped onto the packed codes. */
const STATUS_CODES: Record<string, DirectionalityStatus> = {
	unresolved: 0,
	reciprocal: 1,
	reliably_one_sided_a_to_b: 2,
	reliably_one_sided_b_to_a: 3,
	opposing: 4
};

interface EdgeDirection {
	mode: ComparisonMode;
	display_state: ComparisonDisplayState;
	like_rate: number | null;
	baseline_rate: number | null;
	rate_difference: number | null;
	rate_difference_ci_lower: number | null;
	rate_difference_ci_upper: number | null;
	log_odds_ratio: number | null;
	evidence_score: number | null;
	p_value: number | null;
	q_value: number | null;
	evidence_status: EvidenceStatus;
	eligible_for_production_test: boolean;
}

interface EdgeValidated {
	present: boolean;
	source: string;
	directionality_status: string;
	a_to_b_selected?: boolean;
	b_to_a_selected?: boolean;
	a_to_b_q_value?: number | null;
	b_to_a_q_value?: number | null;
	asymmetry_q_value?: number | null;
}

interface EdgeResponse {
	schema_version: number;
	dataset_version: string;
	author_a: { author_id: number; author_name: string };
	author_b: { author_id: number; author_name: string };
	a_to_b: EdgeDirection;
	b_to_a: EdgeDirection;
	validated_relationship: EdgeValidated;
	error?: string;
}

/** One pair, in the shape the panel already renders, plus which tier it came from. */
export interface PairComparison {
	mode: ComparisonMode;
	validated: boolean;
	/** Only meaningful when `validated`; a dynamic result makes no directional claim. */
	status: DirectionalityStatus | null;
	self: ComparisonDirectionEstimate;
	reverse: ComparisonDirectionEstimate;
	selfStatus: EvidenceStatus;
	reverseStatus: EvidenceStatus;
	/** The backend returns no gap estimate; a validated pair can be enriched from the buckets. */
	asymmetry: AsymmetryEstimate | null;
	datasetVersion: string;
}

export class ComparisonError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ComparisonError';
	}
}

/** The artifact stores −log10(q); the backend returns q itself. */
function negLog10(q: number | null | undefined): number | null {
	if (q === null || q === undefined || !Number.isFinite(q) || q <= 0) return null;
	return -Math.log10(q);
}

function finiteOrNull(value: number | null | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requireMode(value: unknown): ComparisonMode {
	if (value === 'release' || value === 'on_demand') return value;
	throw new ComparisonError('comparison response returned an invalid mode');
}

function requireDisplayState(value: unknown): ComparisonDisplayState {
	if (
		value === 'validated' ||
		value === 'evidence_threshold_not_met' ||
		value === 'on_demand_not_formally_validated' ||
		value === 'not_enough_data'
	) {
		return value;
	}
	throw new ComparisonError('comparison response returned an invalid display state');
}

export interface ComparisonDirectionEstimate {
	selected: boolean;
	mode: ComparisonMode;
	displayState: ComparisonDisplayState;
	rateDifference: number | null;
	ciLower: number | null;
	ciUpper: number | null;
	logOddsRatio: number | null;
	evidenceScore: number | null;
	pValue: number | null;
	negLog10Q: number | null;
	likeRate: number | null;
	baselineRate: number | null;
}

function toEstimate(
	direction: EdgeDirection,
	selected: boolean,
	qValue: number | null | undefined
): ComparisonDirectionEstimate {
	const mode = requireMode(direction.mode);
	const displayState = requireDisplayState(direction.display_state);
	return {
		selected,
		mode,
		displayState,
		rateDifference: finiteOrNull(direction.rate_difference),
		ciLower: finiteOrNull(direction.rate_difference_ci_lower),
		ciUpper: finiteOrNull(direction.rate_difference_ci_upper),
		logOddsRatio: finiteOrNull(direction.log_odds_ratio),
		evidenceScore: finiteOrNull(direction.evidence_score),
		pValue: finiteOrNull(direction.p_value),
		negLog10Q: negLog10(qValue),
		likeRate: finiteOrNull(direction.like_rate),
		baselineRate: finiteOrNull(direction.baseline_rate)
	};
}

/**
 * Compare two authors through the Edge Function.
 *
 * `a` and `b` are the frontend's own author ids. The comparison bundle is built against the
 * same zero-based row index as `authors.json`, and its builder asserts that invariant, so no
 * translation is needed — but it is the one thing that would silently produce a wrong pair if
 * the two artifacts ever drifted apart.
 */
export async function compareAuthorsEdge(
	supabase: SupabaseClient,
	aId: number,
	bId: number
): Promise<PairComparison> {
	const sessionReady = await ensureAnonymousSessionStarted();
	if (!sessionReady) {
		throw new ComparisonError('Could not establish an authenticated session');
	}

	const { data, error } = await supabase.functions.invoke(COMPARE_AUTHORS_FUNCTION, {
		body: { author_a_id: aId, author_b_id: bId }
	});

	if (error) {
		throw new ComparisonError(error.message || `${COMPARE_AUTHORS_FUNCTION} request failed`);
	}

	const payload = data as EdgeResponse | null;
	if (!payload || typeof payload !== 'object') {
		throw new ComparisonError(`${COMPARE_AUTHORS_FUNCTION} returned no result`);
	}
	if (typeof payload.error === 'string' && payload.error.trim()) {
		throw new ComparisonError(payload.error);
	}
	if (!payload.a_to_b || !payload.b_to_a) {
		throw new ComparisonError(`${COMPARE_AUTHORS_FUNCTION} returned an unexpected shape`);
	}

	// The function reorients its answer to the ids as asked, so a/b here are already self/reverse.
	const validated = payload.validated_relationship ?? { present: false, directionality_status: '' };
	const selfMode = requireMode(payload.a_to_b.mode);
	const reverseMode = requireMode(payload.b_to_a.mode);
	if (selfMode !== reverseMode) {
		throw new ComparisonError('comparison response returned mismatched modes');
	}
	const isRelease = selfMode === 'release';

	return {
		mode: selfMode,
		validated: isRelease,
		status: isRelease ? (STATUS_CODES[validated.directionality_status] ?? null) : null,
		self: toEstimate(
			payload.a_to_b,
			isRelease ? validated.a_to_b_selected === true : false,
			isRelease ? validated.a_to_b_q_value : null
		),
		reverse: toEstimate(
			payload.b_to_a,
			isRelease ? validated.b_to_a_selected === true : false,
			isRelease ? validated.b_to_a_q_value : null
		),
		selfStatus: payload.a_to_b.evidence_status,
		reverseStatus: payload.b_to_a.evidence_status,
		asymmetry: null,
		datasetVersion: payload.dataset_version
	};
}
