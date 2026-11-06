import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
	throw new Error('Missing Supabase environment variables');
}

// Preserve prompt endpoint failures instead of adding SDK database-read backoff.
export const supabase = createClient(supabaseUrl, supabaseKey, { db: { retry: false } });

/**
 * Create a Supabase client that uses the user's JWT when provided (e.g. in Authorization header).
 * Use for endpoints that need RLS to see the current user (e.g. recommendation_items).
 */
export function createSupabaseWithAuth(
	accessToken: string | null,
	signal?: AbortSignal
): SupabaseClient {
	if (!accessToken && !signal) return supabase;
	return createClient(supabaseUrl, supabaseKey, {
		db: { retry: false },
		global: {
			headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
			...(signal
				? {
						fetch: (input: RequestInfo | URL, init?: RequestInit) => {
							signal.throwIfAborted();
							return fetch(input, {
								...init,
								signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal
							});
						}
					}
				: {})
		}
	});
}
