import { isFilteredRequest } from '$lib/recommendations/filteredRecommendations';
import type { SupabaseClient } from '@supabase/supabase-js';

export const RECOMMENDATION_HISTORY_RUN_LIMIT = 50;
export type OverallRecommendationRun = {
	id: string | number;
	request_id: string;
	public_id: string | null;
	request_type: string | null;
	result_count: number;
	created_at: string | null;
};

/** Completed requests are authoritative; worker logging is best effort. */
export async function loadRecentOverallRecommendationRequests(supabase: SupabaseClient) {
	const runs: OverallRecommendationRun[] = [];
	const publicIds = new Map<string, string>();
	for (
		let offset = 0;
		runs.length < RECOMMENDATION_HISTORY_RUN_LIMIT;
		offset += RECOMMENDATION_HISTORY_RUN_LIMIT
	) {
		const { data, error } = await supabase
			.from('recommendation_requests')
			.select('id, public_id, request_type, filters, status, result_count, created_at')
			.eq('status', 'completed')
			.gt('result_count', 0)
			.order('created_at', { ascending: false, nullsFirst: false })
			.order('id', { ascending: false })
			.range(offset, offset + RECOMMENDATION_HISTORY_RUN_LIMIT - 1);
		if (error) throw error;
		const batch = data ?? [];
		for (const row of batch) {
			if (
				isFilteredRequest(row.filters) ||
				(row.request_type != null &&
					!['rank_selection', 'recommend_from_selection'].includes(row.request_type))
			)
				continue;
			const request_id = String(row.id);
			runs.push({ ...row, request_id });
			if (typeof row.public_id === 'string') publicIds.set(request_id, row.public_id);
			if (runs.length === RECOMMENDATION_HISTORY_RUN_LIMIT) break;
		}
		if (batch.length < RECOMMENDATION_HISTORY_RUN_LIMIT) break;
	}
	return { runs, publicIds };
}
