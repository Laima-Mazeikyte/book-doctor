import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
	throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Create a Supabase client that uses the user's JWT when provided (e.g. in Authorization header).
 * Use for endpoints that need RLS to see the current user (e.g. recommendation_items).
 */
export function createSupabaseWithAuth(accessToken: string | null): SupabaseClient {
	if (!accessToken) return supabase;
	return createClient(supabaseUrl, supabaseKey, {
		global: { headers: { Authorization: `Bearer ${accessToken}` } }
	});
}

/**
 * Create a Supabase client with service role key (bypasses RLS).
 * Use only in server code (e.g. webhook handler) to read any user's data and write recommendation_log / recommendation_items.
 */
export function createSupabaseServiceRole(): SupabaseClient | null {
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!supabaseUrl || !serviceRoleKey) return null;
	return createClient(supabaseUrl, serviceRoleKey);
}

