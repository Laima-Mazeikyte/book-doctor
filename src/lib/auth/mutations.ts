import type { SupabaseClient } from '@supabase/supabase-js';
import { withTimeout } from '$lib/requests/timeout';

// SDK auth calls can publish a session even after their caller stops waiting.
// Keep the client occupied until the SDK settles, including across modal reopen.
const pending = new WeakSet<SupabaseClient>();

export function hasPendingAuthMutation(client: SupabaseClient): boolean {
	return pending.has(client);
}

export function runAuthMutation<T>(
	client: SupabaseClient,
	operation: () => PromiseLike<T>,
	options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<T> {
	return withTimeout((signal) => {
		if (pending.has(client)) {
			throw new Error(
				'An account change is still being confirmed. Please wait before trying again.'
			);
		}
		pending.add(client);
		return Promise.resolve()
			.then(() => {
				signal.throwIfAborted();
				return operation();
			})
			.finally(() => pending.delete(client));
	}, options);
}
