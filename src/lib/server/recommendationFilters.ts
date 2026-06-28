import type { SupabaseClient } from '@supabase/supabase-js';

type FilterOptions = {
	excludeNotInterested?: boolean;
	excludeRated?: boolean;
};

export async function filterBookIdsExcludingUserLists(
	supabase: SupabaseClient,
	bookIds: string[],
	{ excludeNotInterested = false, excludeRated = false }: FilterOptions
): Promise<string[]> {
	let filtered = bookIds;

	if (excludeNotInterested && filtered.length > 0) {
		const { data: notInterestedRows } = await supabase
			.from('user_not_interested')
			.select('book_id');
		const notInterestedSet = new Set(
			(notInterestedRows ?? [])
				.map((r) => r.book_id)
				.filter((id): id is string => typeof id === 'string')
		);
		filtered = filtered.filter((id) => !notInterestedSet.has(id));
	}

	if (excludeRated && filtered.length > 0) {
		const { data: ratedRows } = await supabase.from('user_ratings').select('book_id');
		const ratedSet = new Set(
			(ratedRows ?? []).map((r) => r.book_id).filter((id): id is string => typeof id === 'string')
		);
		filtered = filtered.filter((id) => !ratedSet.has(id));
	}

	return filtered;
}

/** Parse recommendation_log.created_at to epoch ms, or null when missing/invalid. */
export function parseRecommendationTimestamp(createdAt: string | null | undefined): number | null {
	if (!createdAt) return null;
	const ts = new Date(createdAt).getTime();
	return Number.isFinite(ts) ? ts : null;
}

/** Parse recommendation_items.rank; returns null for missing or non-positive values. */
export function parseRecommendationRank(rankRaw: unknown): number | null {
	if (typeof rankRaw === 'number' && Number.isFinite(rankRaw) && rankRaw > 0) {
		return rankRaw;
	}
	if (typeof rankRaw === 'string' && rankRaw.trim() !== '') {
		const parsed = Number(rankRaw);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return null;
}

export function lastRecommendedAtRecord(
	lastRecommendedMs: Map<string, number>
): Record<string, number> {
	const record: Record<string, number> = {};
	for (const [bid, ms] of lastRecommendedMs) {
		record[String(bid)] = ms;
	}
	return record;
}

export function compareBooksByLastRecommended(
	a: { book_id: string; title?: string },
	b: { book_id: string; title?: string },
	lastRecommendedMs: Map<string, number>
): number {
	const ta = lastRecommendedMs.get(a.book_id);
	const tb = lastRecommendedMs.get(b.book_id);
	if (ta == null && tb == null) return (a.title ?? '').localeCompare(b.title ?? '');
	if (ta == null) return 1;
	if (tb == null) return -1;
	if (tb !== ta) return tb - ta;
	return (a.title ?? '').localeCompare(b.title ?? '');
}
