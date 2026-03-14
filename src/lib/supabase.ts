import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	PUBLIC_SUPABASE_URL,
	PUBLIC_SUPABASE_ANON_KEY
} from '$env/static/public';

/**
 * Browser-only Supabase client for auth and client-side DB access (e.g. user_ratings).
 * Created lazily so the module is safe to load during SSR (no env access at top level).
 * Use getSupabase() from client code (e.g. in onMount); never call from server.
 * Reads PUBLIC_SUPABASE_* (SvelteKit) or VITE_SUPABASE_* (Vite) from env.
 */
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
	if (typeof window === 'undefined') return null;
	if (_client) return _client;
	const url =
		(typeof PUBLIC_SUPABASE_URL === 'string' && PUBLIC_SUPABASE_URL) ||
		import.meta.env.VITE_SUPABASE_URL;
	const key =
		(typeof PUBLIC_SUPABASE_ANON_KEY === 'string' && PUBLIC_SUPABASE_ANON_KEY) ||
		import.meta.env.VITE_SUPABASE_ANON_KEY;
	if (!url || !key) {
		console.error(
			'[supabase] Missing Supabase URL or anon key. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY (or VITE_*) in .env'
		);
		return null;
	}
	_client = createClient(url, key);
	return _client;
}
