import { withTimeout, wait, RequestTimeoutError } from '$lib/requests/timeout';
import { resolve } from '$app/paths';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Book } from '$lib/types/book';

/** Match rate page feed polling. */
export const FEED_POLL_MS = 1000;
export const FEED_TIMEOUT_MS = 60_000;

export type CuratedFeedPollResult =
	| { kind: 'completed'; books: Book[] }
	| { kind: 'failed' | 'skipped' | 'http_error' | 'timeout' | 'aborted' };

type PendingFeed = { since: number; requestId?: string };
const pendingByOwner = new Map<string, PendingFeed>();
const inserts = new Map<string, Promise<string | null>>();
const journalKey = (owner: string) => 'book-doctor:feed-generation:v2:' + owner;

function readPending(owner: string): PendingFeed | null {
	try {
		const raw =
			typeof localStorage === 'undefined' ? null : localStorage.getItem(journalKey(owner));
		const value = raw ? JSON.parse(raw) : null;
		if (
			value &&
			typeof value.since === 'number' &&
			(value.requestId === undefined || typeof value.requestId === 'string')
		)
			return value;
	} catch {
		/* In-memory coordination still works when storage is blocked. */
	}
	return pendingByOwner.get(owner) ?? null;
}
function savePending(owner: string, value: PendingFeed | null) {
	if (value) pendingByOwner.set(owner, value);
	else pendingByOwner.delete(owner);
	try {
		if (typeof localStorage === 'undefined') return;
		if (value) localStorage.setItem(journalKey(owner), JSON.stringify(value));
		else localStorage.removeItem(journalKey(owner));
	} catch {
		/* Do not treat a storage failure as a cancelled backend job. */
	}
}

async function reconcileAndInsert(
	supabase: SupabaseClient,
	userId: string
): Promise<string | null> {
	const pending = readPending(userId);
	// Navigation and polling deadlines do not cancel generation. Reconcile before every insert.
	const { data: active, error: readError } = await withTimeout((signal) =>
		supabase
			.from('feed_requests')
			.select('public_id, status, created_at')
			.eq('user_id', userId)
			.in('status', ['pending', 'processing'])
			.order('created_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(1)
			.abortSignal(signal)
			.maybeSingle()
	);
	if (readError) throw new Error('Could not check the current feed request. Please try again.');
	if (active && ['pending', 'processing'].includes(active.status)) {
		savePending(userId, { since: Date.parse(active.created_at), requestId: active.public_id });
		return active.public_id;
	}
	if (pending && !pending.requestId) {
		// A lost insert response can still have committed. Recover its result, even if already complete.
		const { data: latest, error: recoveryError } = await withTimeout((signal) =>
			supabase
				.from('feed_requests')
				.select('public_id, status, created_at')
				.eq('user_id', userId)
				.gte('created_at', new Date(pending.since - 5000).toISOString())
				.order('created_at', { ascending: false })
				.order('id', { ascending: false })
				.limit(1)
				.abortSignal(signal)
				.maybeSingle()
		);
		if (recoveryError) throw new RequestTimeoutError();
		if (latest && Date.parse(latest.created_at) >= pending.since - 5000) {
			savePending(userId, { since: pending.since, requestId: latest.public_id });
			return latest.public_id;
		}
		throw new RequestTimeoutError();
	}
	savePending(userId, { since: Date.now() });
	const { data, error } = await withTimeout((signal) =>
		supabase
			.from('feed_requests')
			.insert({ user_id: userId })
			.select('public_id')
			.abortSignal(signal)
			.single()
	);
	if (error || !data?.public_id) {
		// Only definitive rejections are safe to retry as a new job.
		if (error && ['23503', '23514', '42501', '42703', 'P0001', 'PGRST204'].includes(error.code)) {
			savePending(userId, null);
			return null;
		}
		throw new RequestTimeoutError();
	}
	savePending(userId, { since: Date.now(), requestId: data.public_id });
	return data.public_id;
}

/** Serialize inserts per account and reuse active backend jobs, including across tabs. */
export function insertFeedRequestRow(
	supabase: SupabaseClient,
	userId: string
): Promise<string | null> {
	const existing = inserts.get(userId);
	if (existing) return existing;
	const operation: Promise<string | null> = (async () =>
		typeof navigator !== 'undefined' && navigator.locks
			? navigator.locks.request('book-doctor:feed-generation:' + userId, () =>
					reconcileAndInsert(supabase, userId)
				)
			: reconcileAndInsert(supabase, userId))();
	inserts.set(userId, operation);
	void operation
		.finally(() => {
			if (inserts.get(userId) === operation) inserts.delete(userId);
		})
		.catch(() => {});
	return operation;
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
