import { describe, expect, it } from 'vitest';
import { bookUuidFromJoinRow } from './book-id-resolver';

describe('bookUuidFromJoinRow', () => {
	it('returns join UUID when present', () => {
		expect(
			bookUuidFromJoinRow({ book_id: '01ULID', books: { id: 'uuid-1', book_id: '01ULID' } }, {})
		).toBe('uuid-1');
	});

	it('returns resolved UUID from lookup map', () => {
		expect(bookUuidFromJoinRow({ book_id: '01ULID' }, { '01ULID': 'uuid-2' })).toBe('uuid-2');
	});

	it('returns null instead of ULID when UUID cannot be resolved', () => {
		expect(bookUuidFromJoinRow({ book_id: '01ULID' }, {})).toBeNull();
	});
});
