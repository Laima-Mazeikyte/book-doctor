import { describe, expect, it } from 'vitest';
import { searchAuthorOptions } from './authorOptions';

describe('searchAuthorOptions', () => {
	it('finds partial surnames and ranks common matching authors first', () => {
		const options: [string, number][] = [
			['Ahren Sanders', 2],
			['Brandon Sanderson', 35],
			['A. Sanders', 1],
			['Some Other Name', 100]
		];
		expect(searchAuthorOptions(options, 'Sanders')).toEqual([
			'Brandon Sanderson',
			'Ahren Sanders',
			'A. Sanders'
		]);
	});

	it('finds accented names without changing the canonical label', () => {
		expect(searchAuthorOptions([['José García', 3]], 'garcia')).toEqual(['José García']);
	});
});
