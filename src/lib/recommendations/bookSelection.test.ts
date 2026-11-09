import { describe, expect, it } from 'vitest';
import {
	addSelection,
	emptySelectionDrafts,
	parseSelectionRequest,
	readSelectionDrafts,
	sameSelection,
	writeSelectionDrafts
} from './bookSelection';
import type { Book } from '$lib/types/book';

const book = (n: number): Book => ({
	id: `uuid-${n}`,
	book_id: `01${String(n).padStart(24, '0')}`,
	title: `Book ${n}`,
	author: 'Author'
});
const ids = (count: number) => Array.from({ length: count }, (_, i) => book(i).book_id);
describe('book selection contract and drafts', () => {
	it('accepts both modes at the 4 and 200 book boundaries without mutating input', () => {
		for (const request_type of ['rank_selection', 'recommend_from_selection']) {
			for (const count of [4, 200]) {
				const input = { request_type, book_ids: ids(count) };
				expect(parseSelectionRequest(input)).toEqual(input);
				expect(parseSelectionRequest(input).book_ids).not.toBe(input.book_ids);
			}
		}
	});
	it('rejects invalid modes, counts, duplicates, UUIDs, malformed IDs and unsupported fields', () => {
		for (const value of [
			null,
			[],
			{ request_type: 'other', book_ids: ids(4) },
			{ request_type: 'rank_selection', book_ids: ids(3) },
			{ request_type: 'rank_selection', book_ids: ids(201) },
			{ request_type: 'rank_selection', book_ids: [...ids(3), ...ids(1)] },
			{
				request_type: 'rank_selection',
				book_ids: [...ids(3), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']
			},
			{ request_type: 'rank_selection', book_ids: [...ids(3), 'IIIIIIIIIIIIIIIIIIIIIIIIII'] },
			{ request_type: 'rank_selection', book_ids: ids(4), filters: {} }
		])
			expect(() => parseSelectionRequest(value)).toThrow();
	});
	it('combines overlapping sources in recency order and caps the combined selection at 200', () => {
		const first = Array.from({ length: 195 }, (_, i) => book(i));
		const added = addSelection(
			first,
			Array.from({ length: 40 }, (_, i) => book(i + 190))
		);
		expect(added).toHaveLength(200);
		expect(added[199]).toEqual(book(199));
		expect(first).toHaveLength(195);
		expect(new Set(added.map((b) => b.book_id)).size).toBe(200);
	});
	it('compares snapshots independently of presentation order and distinguishes request modes', () => {
		const a = { request_type: 'rank_selection' as const, book_ids: ids(4) };
		expect(sameSelection(a, { ...a, book_ids: [...a.book_ids].reverse() })).toBe(true);
		expect(sameSelection(a, { ...a, request_type: 'recommend_from_selection' })).toBe(false);
		expect(sameSelection(a, { ...a, book_ids: ids(5) })).toBe(false);
	});
	it('restores separate account-scoped mode drafts and omits large display metadata', () => {
		const data = new Map<string, string>();
		const storage = {
			getItem: (key: string) => data.get(key) ?? null,
			setItem: (key: string, value: string) => {
				data.set(key, value);
			}
		};
		const drafts = {
			rank_selection: [book(1)],
			recommend_from_selection: [{ ...book(2), summary: 'Do not persist' }]
		};
		writeSelectionDrafts(storage, 'a', drafts);
		expect(readSelectionDrafts(storage, 'a')).toEqual({
			...drafts,
			recommend_from_selection: [book(2)]
		});
		expect(readSelectionDrafts(storage, 'b')).toEqual(emptySelectionDrafts());
		expect([...data.values()][0]).not.toContain('Do not persist');
	});
	it('tolerates invalid drafts and disabled storage', () => {
		expect(readSelectionDrafts({ getItem: () => '{' }, 'a')).toEqual(emptySelectionDrafts());
		expect(() =>
			writeSelectionDrafts(
				{
					setItem: () => {
						throw new Error('Quota');
					}
				},
				'a',
				emptySelectionDrafts()
			)
		).not.toThrow();
	});
});
