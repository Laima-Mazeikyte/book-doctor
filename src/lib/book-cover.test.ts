import { describe, expect, it } from 'vitest';

import { coverUrlForBookIdWithBase } from './book-cover';

describe('coverUrlForBookIdWithBase', () => {
	it('uses ULID-720.avif filenames', () => {
		expect(
			coverUrlForBookIdWithBase(
				'https://covers.example.test/',
				'01KR2ADTNG29NSQV23VAGV8FXB'
			)
		).toBe('https://covers.example.test/01KR2ADTNG29NSQV23VAGV8FXB-720.avif');
	});

	it('omits covers for non-string legacy ids', () => {
		expect(coverUrlForBookIdWithBase('https://covers.example.test/', 12345)).toBeUndefined();
	});
});
