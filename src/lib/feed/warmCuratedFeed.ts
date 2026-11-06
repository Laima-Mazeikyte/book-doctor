import { withTimeout, wait, RequestTimeoutError } from '$lib/requests/timeout';
import { resolve } from '$app/paths';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Book } from '$lib/types/book';

/** Match rate page feed polling. */
export const FEED_POLL_MS = 3000;
export const FEED_TIMEOUT_MS = 60_000;

export type CuratedFeedPollResult =
	| { kind: 'completed'; books: Book[] }
	| { kind: 'failed' | 'skipped' | 'http_error' | 'timeout' | 'aborted' };

// An unacknowledged insert must not be retried by another automatic feed refresh.
const uncertainOwners = new Set<string>();

export async function insertFeedRequestRow(
	supabase: SupabaseClient,
	userId: string
): Promise<string | null> {
	if (uncertainOwners.has(userId)) throw new RequestTimeoutError();
	try {
		const { data, error } = await withTimeout((signal) =>
			supabase
				.from('feed_requests')
				.insert({ user_id: userId })
				.select('public_id')
				.abortSignal(signal)
				.single()
		);

		if (error || !data?.public_id) {
			console.error('[feed] feed_requests insert:', error);
			return null;
		}
		return data.public_id;
	} catch (error) {
		if (error instanceof RequestTimeoutError) uncertainOwners.add(userId);
		throw error;
	}
}

export async function pollCuratedFeedRequest(
	requestId: string,
	accessToken: string,
	signal?: AbortSignal
): Promise<CuratedFeedPollResult> {
	const feedPollUrl = `${resolve('/api/feed')}?request_id=${encodeURIComponent(requestId)}`;

	try {
		return await withTimeout(
			async (signal): Promise<CuratedFeedPollResult> => {
				while (true) {
					signal.throwIfAborted();
					const payload = await withTimeout(
						async (signal) => {
							const res = await fetch(feedPollUrl, {
								headers: { Authorization: `Bearer ${accessToken}` },
								signal
							});

							if (!res.ok) {
								throw new Error(`Feed status request failed (${res.status})`);
							}

							const payload: {
								status: string;
								books: Book[];
								request_id: string;
								error_message?: string | null;
							} = await res.json();
							return payload;
						},
						{ signal }
					);

					if (payload.status === 'failed' || payload.status === 'skipped') {
						return { kind: payload.status === 'skipped' ? 'skipped' : 'failed' };
					}

					if (payload.status === 'completed') {
						return { kind: 'completed', books: payload.books ?? [] };
					}

					await wait(FEED_POLL_MS, signal);
				}
			},
			{ signal, timeoutMs: FEED_TIMEOUT_MS }
		);
	} catch (err) {
		if (err instanceof RequestTimeoutError) return { kind: 'timeout' };
		if (signal?.aborted) return { kind: 'aborted' };
		return { kind: 'http_error' };
	}
}
