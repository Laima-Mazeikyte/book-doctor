import type { SupabaseClient } from '@supabase/supabase-js';

/** Resolve aliases under the caller's RLS; retain IDs for pre-lifecycle legacy runs. */
export async function recommendationPublicIds(supabase: SupabaseClient, ids: string[]) {
	const numericIds = [...new Set(ids.filter((id) => /^\d+$/.test(id)))];
	const aliases = new Map<string, string>();
	for (let start = 0; start < numericIds.length; start += 100) {
		const { data, error } = await supabase
			.from('recommendation_requests')
			.select('id, public_id')
			.in('id', numericIds.slice(start, start + 100));
		if (error) throw error;
		for (const row of data ?? []) {
			if (typeof row.public_id === 'string') aliases.set(String(row.id), row.public_id);
		}
	}
	return aliases;
}
