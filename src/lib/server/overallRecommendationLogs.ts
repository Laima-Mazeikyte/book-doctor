import { isFilteredRequest } from '$lib/recommendations/filteredRecommendations';
import type { SupabaseClient } from '@supabase/supabase-js';

type LogRow = { request_id: string | null; created_at?: string | null };

/** Requests absent from the newer lifecycle table are historical overall runs. */
export async function overallRecommendationLogs<T extends LogRow>(
	supabase: SupabaseClient,
	logs: T[]
): Promise<T[]> {
	const ids = [
		...new Set(
			logs
				.map((log) => log.request_id)
				.filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id))
		)
	];
	const filteredIds = new Set<string>();
	for (let start = 0; start < ids.length; start += 100) {
		const { data, error } = await supabase
			.from('recommendation_requests')
			.select('id, filters')
			.in('id', ids.slice(start, start + 100));
		if (error) throw error;
		for (const row of data ?? []) {
			if (isFilteredRequest(row.filters)) filteredIds.add(String(row.id));
		}
	}
	return logs.filter((log) => !log.request_id || !filteredIds.has(log.request_id));
}
