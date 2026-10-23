import { describe, expect, it } from 'vitest';
import { bookPath, bookSlug } from './bookUrl';

describe('public book URLs', () => {
	it('keeps readable whole words within the word and length limits', () => {
		expect(bookSlug('The Hitchhiker’s Guide to the Galaxy: A Novel')).toBe(
			'the-hitchhikers-guide-to-the-galaxy'
		);
		expect(bookSlug('A very ' + 'long'.repeat(20))).toBe('a-very');
		expect(bookSlug('Émile & the Sea!')).toBe('emile-the-sea');
		expect(bookSlug('???')).toBe('book');
	});
	it('uses a stable ID and encodes non-Latin slugs consistently with URL.pathname', () => {
		const path = bookPath({ book_id: '01KR2ADTNG29NSQV23VAGV8FXB', title: '夜の本' });
		expect(new URL(path, 'https://unread.example').pathname).toBe(path);
		expect(path).toContain('/books/01KR2ADTNG29NSQV23VAGV8FXB/');
	});
});
