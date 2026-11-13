import { describe, expect, it } from 'vitest';
import { parseFlavorGroups, hydrateFlavorGroups, FLAVOR_KEYS } from './flavorGroups';
import { flavorFixture } from './flavorGroups.fixture';

describe('grouped recommendation contract', () => {
	it('retains all ten groups including empty themes and local ranks', () => {
		const payload = flavorFixture(
			Array.from({ length: 9 }, (_, i) => ({ book_id: String(i), rank: i + 1 }))
		);
		expect(parseFlavorGroups(payload).groups.map((group) => group.key)).toEqual([...FLAVOR_KEYS]);
		expect(payload.groups[1].items.map((item) => item.rank)).toEqual([1, 2]);
		expect(
			hydrateFlavorGroups(payload, [{ id: '8', book_id: '8', title: 'Theme', author: 'Author' }])[1]
				.books[0].title
		).toBe('Theme');
		expect(payload.groups[9].items).toEqual([]);
	});
	it('rejects legacy, malformed, reordered, duplicate, and over-capacity payloads', () => {
		const reordered = flavorFixture();
		[reordered.groups[0], reordered.groups[1]] = [reordered.groups[1], reordered.groups[0]];
		const duplicate = flavorFixture([{ book_id: 'same', rank: 1 }]);
		duplicate.groups[1].items = [{ book_id: 'same', rank: 1 }];
		const oversized = flavorFixture();
		oversized.groups[1].items = Array.from({ length: 3 }, (_, i) => ({
			book_id: String(i),
			rank: i + 1
		}));
		for (const value of [null, {}, reordered, duplicate, oversized])
			expect(() => parseFlavorGroups(value)).toThrow();
	});
});
