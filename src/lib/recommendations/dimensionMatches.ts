export const DIMENSION_KEYS = [
	'spice',
	'discussion_potential',
	'pace',
	'originality',
	'vocabulary',
	'violence',
	'depth'
] as const;

export type DimensionKey = (typeof DIMENSION_KEYS)[number];
export type DimensionMatch = { dimension_key: DimensionKey; candidate_raw_score: number };
export type DimensionMatchSnapshot = { request_id: string; matches: DimensionMatch[] };
/** Recommendation-only metadata, scoped to the current account and source request. */
export type DimensionMatchSnapshotsByBookId = Record<string, DimensionMatchSnapshot>;

const DIMENSION_LABEL_COUNTS = {
	spice: 5,
	vocabulary: 5,
	pace: 5,
	originality: 5,
	violence: 5,
	depth: 4,
	discussion_potential: 3
} as const satisfies Record<DimensionKey, number>;

export function normalizeDimensionMatches(value: unknown): DimensionMatch[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value.flatMap((entry) => {
		if (!entry || typeof entry !== 'object') return [];
		const { dimension_key: key, candidate_raw_score: score } = entry;
		if (
			!DIMENSION_KEYS.includes(key) ||
			seen.has(key) ||
			typeof score !== 'number' ||
			!Number.isFinite(score) ||
			score < 0 ||
			score > 1
		)
			return [];
		seen.add(key);
		return [{ dimension_key: key as DimensionKey, candidate_raw_score: score }];
	});
}

/** Rows arrive newest request first. Even an empty first snapshot wins. */
export function buildDimensionMatchSnapshotsByBookId(
	rows: readonly {
		book_id?: unknown;
		request_id?: unknown;
		dimension_matches?: unknown;
	}[]
): DimensionMatchSnapshotsByBookId {
	const snapshots: DimensionMatchSnapshotsByBookId = {};
	for (const row of rows) {
		if (typeof row.book_id !== 'string' || typeof row.request_id !== 'string') continue;
		const bookId = row.book_id.trim();
		if (!bookId || !row.request_id.trim() || Object.hasOwn(snapshots, bookId)) continue;
		Object.defineProperty(snapshots, bookId, {
			value: {
				request_id: row.request_id,
				matches: normalizeDimensionMatches(row.dimension_matches)
			},
			enumerable: true,
			configurable: true,
			writable: true
		});
	}
	return snapshots;
}

/** Preserve provenance while accepting older or malformed API responses. */
export function normalizeDimensionMatchSnapshots(value: unknown): DimensionMatchSnapshotsByBookId {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return buildDimensionMatchSnapshotsByBookId(
		Object.entries(value).flatMap(([book_id, snapshot]) => {
			if (!snapshot || typeof snapshot !== 'object') return [];
			return [{ book_id, request_id: snapshot.request_id, dimension_matches: snapshot.matches }];
		})
	);
}

export function dimensionMatchCopyKey(match: DimensionMatch): string {
	const count = DIMENSION_LABEL_COUNTS[match.dimension_key];
	const index = Math.round(match.candidate_raw_score * (count - 1));

	return `recommendations.dimensionMatches.values.${match.dimension_key}.${index}`;
}
