import { describe, expect, it } from 'vitest';
import { bookPath } from './bookUrl';

describe('public book URLs', () => {
	it('uses the stored address and refuses to invent missing slugs', () => {
		expect(bookPath({ slug: 'the-secret-history-donna-tartt' })).toBe(
			'/books/the-secret-history-donna-tartt'
		);
		expect(() => bookPath({})).toThrow('Missing public book slug');
	});
	it('encodes non-Latin labels consistently with URL.pathname', () => {
		const path = bookPath({ slug: '夜の本-著者' });
		expect(new URL(path, 'https://unread.example').pathname).toBe(path);
		expect(decodeURIComponent(path)).toBe('/books/夜の本-著者');
	});
});
