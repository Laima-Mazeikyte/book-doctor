import { getSupabase } from '$lib/supabase';

export interface BugInsert {
	id: string;
	description: string;
	author: string | null;
	viewport_width: number | null;
	device_info: Record<string, unknown> | null;
}

export async function submitBug(payload: BugInsert): Promise<{ error: Error | null }> {
	const supabase = getSupabase();
	if (!supabase) {
		return { error: new Error('Supabase client not available') };
	}

	const { error } = await supabase.from('bugs').insert({
		id: payload.id,
		description: payload.description,
		author: payload.author,
		viewport_width: payload.viewport_width,
		device_info: payload.device_info
	});

	return { error: error ? new Error(error.message) : null };
}
