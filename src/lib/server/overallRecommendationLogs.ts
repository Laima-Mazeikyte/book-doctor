import { isFilteredRequest } from '$lib/recommendations/filteredRecommendations';
import type { SupabaseClient } from '@supabase/supabase-js';

type LogRow = { request_id: string | null; created_at?: string | null };
type OverallRecommendationLogs<T extends LogRow> = {
	logs: T[];
	publicIds: Map<string, string>;
};

export const RECOMMENDATION_HISTORY_RUN_LIMIT = 50;

/** Read enough recent logs to retain 50 overall runs after excluding filtered requests. */
export async function loadRecentOverallRecommendationLogs(
	supabase: SupabaseClient
): Promise<OverallRecommendationLogs<LogRow>> {
	const logs: LogRow[] = [];
	const publicIds = new Map<string, string>();
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
		const overall = await overallRecommendationLogs(supabase, batch);
		for (const log of overall.logs.slice(0, RECOMMENDATION_HISTORY_RUN_LIMIT - logs.length)) {
			logs.push(log);
			const publicId = log.request_id ? overall.publicIds.get(log.request_id) : undefined;
			if (log.request_id && publicId !== undefined) publicIds.set(log.request_id, publicId);
		}
		if (batch.length < RECOMMENDATION_HISTORY_RUN_LIMIT) break;
	}
	return { logs, publicIds };
}

/** Reuse request metadata for public references; missing lifecycle rows are historical overall runs. */
export async function overallRecommendationLogs<T extends LogRow>(
	supabase: SupabaseClient,
	logs: T[]
): Promise<OverallRecommendationLogs<T>> {
	const ids = [
		...new Set(
			logs
				.map((log) => log.request_id)
				.filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id))
		)
	];
	const filteredIds = new Set<string>();
	const publicIds = new Map<string, string>();
	for (let start = 0; start < ids.length; start += 100) {
		const { data, error } = await supabase
			.from('recommendation_requests')
			.select('id, filters, public_id')
			.in('id', ids.slice(start, start + 100));
		if (error) throw error;
		for (const row of data ?? []) {
			if (isFilteredRequest(row.filters)) filteredIds.add(String(row.id));
			else if (typeof row.public_id === 'string') publicIds.set(String(row.id), row.public_id);
		}
	}
	return {
		logs: logs.filter((log) => !log.request_id || !filteredIds.has(log.request_id)),
		publicIds
	};
}
