import { describe, expect, it } from 'vitest';
import {
	decodeNotInterestedCursor,
	encodeNotInterestedCursor,
	type NotInterestedCursor
} from './cursor';

const cursor: NotInterestedCursor = {
	version: 1,
	order: 'newest',
	createdAt: '2026-09-07T12:34:56.123456Z',
	bookId: '01K6EXAMPLEBOOKID0000000000'
};

describe('not interested cursors', () => {
	it('round-trips the sort order and timestamp precision', () => {
		const encoded = encodeNotInterestedCursor(cursor);
		expect(decodeNotInterestedCursor(encoded, 'newest')).toEqual(cursor);
	});

	it('rejects malformed cursors and sort mismatches', () => {
		expect(() => decodeNotInterestedCursor('', 'newest')).toThrow();
		expect(() => decodeNotInterestedCursor('not-base64', 'newest')).toThrow();
		expect(() => decodeNotInterestedCursor(encodeNotInterestedCursor(cursor), 'oldest')).toThrow();
	});

	it('rejects an oversized cursor', () => {
		expect(() => decodeNotInterestedCursor('a'.repeat(513), 'newest')).toThrow();
	});
});
