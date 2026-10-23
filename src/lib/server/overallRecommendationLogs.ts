import { isFilteredRequest } from '$lib/recommendations/filteredRecommendations';
import type { SupabaseClient } from '@supabase/supabase-js';

type LogRow = { request_id: string | null; created_at?: string | null };

export const RECOMMENDATION_HISTORY_RUN_LIMIT = 50;

/** Read enough recent logs to retain 50 overall runs after excluding filtered requests. */
export async function loadRecentOverallRecommendationLogs(
	supabase: SupabaseClient
): Promise<LogRow[]> {
	const logs: LogRow[] = [];
	for (
		let offset = 0;
		logs.length < RECOMMENDATION_HISTORY_RUN_LIMIT;
		offset += RECOMMENDATION_HISTORY_RUN_LIMIT
	) {
		const { data, error } = await supabase
			.from('recommendation_log')
			.select('request_id, created_at')
			.order('created_at', { ascending: false, nullsFirst: false })
			.order('id', { ascending: false })
			.range(offset, offset + RECOMMENDATION_HISTORY_RUN_LIMIT - 1);
		if (error) throw error;
		const batch = (data ?? []) as LogRow[];
		logs.push(...(await overallRecommendationLogs(supabase, batch)));
		if (batch.length < RECOMMENDATION_HISTORY_RUN_LIMIT) break;
	}
	return logs.slice(0, RECOMMENDATION_HISTORY_RUN_LIMIT);
}

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
