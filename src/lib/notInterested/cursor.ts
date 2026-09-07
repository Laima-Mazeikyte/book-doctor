import { error } from '@sveltejs/kit';
import type { NotInterestedCursor, NotInterestedOrder } from './types';

export type { NotInterestedCursor, NotInterestedOrder } from './types';

const MAX_CURSOR_LENGTH = 512;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const BOOK_ID = /^[A-Za-z0-9_-]{1,128}$/;

function isNotInterestedOrder(value: unknown): value is NotInterestedOrder {
	return value === 'newest' || value === 'oldest';
}

function isValidTimestamp(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length <= 64 &&
		ISO_TIMESTAMP.test(value) &&
		Number.isFinite(Date.parse(value))
	);
}

function isValidBookId(value: unknown): value is string {
	return typeof value === 'string' && BOOK_ID.test(value);
}

function toBase64Url(value: string): string {
	return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value: string): string | null {
	if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
	try {
		return Buffer.from(value, 'base64url').toString('utf8');
	} catch {
		return null;
	}
}

export function encodeNotInterestedCursor(cursor: NotInterestedCursor): string {
	return toBase64Url(
		JSON.stringify({
			v: cursor.version,
			order: cursor.order,
			created_at: cursor.createdAt,
			book_id: cursor.bookId
		})
	);
}

/**
 * Decode and validate a cursor before it is interpolated into a PostgREST filter.
 * The timestamp is deliberately kept as the original string; it is never normalized through
 * Date.toISOString(), which would discard sub-millisecond precision.
 */
export function decodeNotInterestedCursor(
	value: string | null | undefined,
	expectedOrder: NotInterestedOrder
): NotInterestedCursor {
	if (!value || value.length > MAX_CURSOR_LENGTH) {
		throw error(400, 'Invalid cursor');
	}

	const decoded = fromBase64Url(value);
	if (!decoded) throw error(400, 'Invalid cursor');

	let parsed: unknown;
	try {
		parsed = JSON.parse(decoded);
	} catch {
		throw error(400, 'Invalid cursor');
	}

	if (!parsed || typeof parsed !== 'object') throw error(400, 'Invalid cursor');
	const candidate = parsed as Record<string, unknown>;
	if (
		candidate.v !== 1 ||
		!isNotInterestedOrder(candidate.order) ||
		candidate.order !== expectedOrder ||
		!isValidTimestamp(candidate.created_at) ||
		!isValidBookId(candidate.book_id)
	) {
		throw error(400, 'Invalid cursor');
	}

	return {
		version: 1,
		order: candidate.order,
		createdAt: candidate.created_at,
		bookId: candidate.book_id
	};
}
