import { describe, expect, it } from 'vitest';
import { groupRecognitionReceipts, recognitionStatusLabel } from './presentation';
import type { RecognitionReceipt } from './types';

const receipts: RecognitionReceipt[] = [
	{ workTitle: 'Second work', awardName: 'Prize B', year: 2021, status: 'shortlist', tier: 2 },
	{ workTitle: 'First work', awardName: 'Prize A', year: null, status: 'win', tier: 1 },
	{ workTitle: 'Second work', awardName: 'Prize C', year: 2022, status: 'honor', tier: 3 },
	{ workTitle: 'First work', awardName: 'Prize A', year: null, status: 'win', tier: 1 }
];

describe('recognition presentation', () => {
	it('deduplicates exact receipts and groups works by first appearance', () => {
		const works = groupRecognitionReceipts(receipts);
		expect(works.map((work) => work.title)).toEqual(['Second work', 'First work']);
		expect(works[0].receipts.map((receipt) => receipt.awardName)).toEqual(['Prize B', 'Prize C']);
		expect(works[1].receipts).toHaveLength(1);
	});

	it('maps known and unexpected statuses to user-facing labels', () => {
		expect(recognitionStatusLabel('win')).toBe('Winner');
		expect(recognitionStatusLabel('shortlist')).toBe('Shortlisted');
		expect(recognitionStatusLabel('longlist')).toBe('Longlisted');
		expect(recognitionStatusLabel('nominee')).toBe('Nominee');
		expect(recognitionStatusLabel('honor')).toBe('Honor');
		expect(recognitionStatusLabel('other')).toBe('Recognized');
	});
});
