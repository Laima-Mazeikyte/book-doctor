import { resolve } from '$app/paths';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Book } from '$lib/types/book';

/** Match rate page feed polling. */
export const FEED_POLL_MS = 3000;
export const FEED_TIMEOUT_MS = 60_000;

export type CuratedFeedPollResult =
	| { kind: 'completed'; books: Book[] }
	| { kind: 'failed' | 'skipped' | 'http_error' | 'timeout' | 'aborted' };

/** Resolves after `ms`, or rejects with an `AbortError` if `signal` fires first. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(new DOMException('Aborted', 'AbortError'));
			},
			{ once: true }
		);
	});
}

export async function insertFeedRequestRow(
	supabase: SupabaseClient,
	userId: string
): Promise<string | null> {
	const { data, error } = await supabase
		.from('feed_requests')
		.insert({ user_id: userId })
		.select('id')
		.single();

	if (error || data?.id == null) {
		console.error('[feed] feed_requests insert:', error);
		return null;
	}
	return String(data.id);
}

export async function pollCuratedFeedRequest(
	requestId: string,
	accessToken: string,
	signal?: AbortSignal
): Promise<CuratedFeedPollResult> {
	const started = Date.now();

	const feedPollUrl = `${resolve('/api/feed')}?request_id=${encodeURIComponent(requestId)}`;

	try {
		while (Date.now() - started < FEED_TIMEOUT_MS) {
			const res = await fetch(feedPollUrl, {
				headers: { Authorization: `Bearer ${accessToken}` },
				signal
			});

			if (!res.ok) {
				return { kind: 'http_error' };
			}

			const payload: {
				status: string;
				books: Book[];
				request_id: string;
				error_message?: string | null;
			} = await res.json();

			if (payload.status === 'failed' || payload.status === 'skipped') {
				return { kind: payload.status === 'skipped' ? 'skipped' : 'failed' };
			}

			if (payload.status === 'completed') {
				return { kind: 'completed', books: payload.books ?? [] };
			}

			await delay(FEED_POLL_MS, signal);
		}

		return { kind: 'timeout' };
	} catch (err) {
		// Caller aborted (e.g. navigated away): stop quietly, don't surface as an error.
		if (err instanceof DOMException && err.name === 'AbortError') {
			return { kind: 'aborted' };
		}
		throw err;
	}
}
