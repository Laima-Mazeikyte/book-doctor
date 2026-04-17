import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

const MAX_IDS = 64;

/** Batch-load `books.summary` by UUID `id` for callers that need live text without a full row fetch. */
export const GET: RequestHandler = async ({ url }) => {
	const raw = url.searchParams.get('ids') ?? '';
	const ids = [
		...new Set(
			raw
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		)
	].slice(0, MAX_IDS);

	if (ids.length === 0) {
		return json({ summaries: {} as Record<string, string> });
	}

	const { data, error: dbError } = await supabase.from('books').select('id, summary').in('id', ids);

	if (dbError) {
		console.error(dbError);
		throw error(500, 'Failed to load summaries');
	}

	const summaries: Record<string, string> = {};
	for (const row of data ?? []) {
		const id = row.id != null ? String(row.id) : '';
		const s = typeof row.summary === 'string' ? row.summary.trim() : '';
		if (id && s) summaries[id] = row.summary as string;
	}

	return json({ summaries });
};
