import { describe, expect, it } from 'vitest';
import {
	applyCorrection,
	diffCorrection,
	parseCorrectionChanges,
	type CorrectionValues
} from './model';

const original: CorrectionValues = {
	title: 'Book',
	author: 'Author',
	year: '1998',
	summary: 'Description',
	coverUrl: 'https://example.com/cover.jpg',
	genres: ['Fantasy', 'Horror']
};

describe('field correction proposals', () => {
	it('records explicit genre operations without changing other fields', () => {
		const changes = diffCorrection(
			original,
			{ ...original, title: 'Ignored title', genres: ['fantasy', '  Solar   Gothic  '] },
			'genres'
		);
		expect(changes).toEqual({ genres: { add: ['Solar Gothic'], remove: ['Horror'] } });
		expect(applyCorrection(original, changes).genres).toEqual(['Fantasy', 'Solar Gothic']);
		expect(original.genres).toEqual(['Fantasy', 'Horror']);
	});
	it('only submits the selected field and treats reverted edits as empty', () => {
		expect(
			diffCorrection(original, { ...original, title: 'New title', author: 'New author' }, 'author')
		).toEqual({ author: 'New author' });
		expect(diffCorrection(original, { ...original, title: ' Book ' }, 'title')).toEqual({});
		expect(() => parseCorrectionChanges({})).toThrow('Please enter a correction');
		expect(() => parseCorrectionChanges({ title: 'Title', author: 'Author' })).toThrow('one field');
	});
	it('requires a category and nonempty explanation instead of a replacement description', () => {
		const issue = { category: 'spoiler', explanation: ' Reveals the ending. ' };
		expect(parseCorrectionChanges({ description: issue })).toEqual({
			description: { category: 'spoiler', explanation: 'Reveals the ending.' }
		});
		expect(() => parseCorrectionChanges({ summary: 'Replacement text' })).toThrow('Unsupported');
		for (const [value, expected] of [
			[{ category: '', explanation: 'A problem' }, 'Please select the type of problem.'],
			[{ category: 'generic', explanation: 'A problem' }, 'Please select the type of problem.'],
			[
				{ category: 'other', explanation: ' ' },
				'Please provide a short description of the problem.'
			],
			[{ category: 'factual', explanation: 'a'.repeat(601) }, '600 characters'],
			[{ category: 'other', explanation: 'A problem', extra: true }, 'problem type']
		] as const) {
			expect(() => parseCorrectionChanges({ description: value })).toThrow(expected);
		}
		expect(
			applyCorrection(original, {
				description: { category: 'factual', explanation: 'Wrong date.' }
			}).summary
		).toBe(original.summary);
		expect(
			diffCorrection(original, original, 'description', { category: 'factual', explanation: '' })
		).toEqual({});
	});
	it('rejects unsupported fields, scripts in cover URLs, credentials, and conflicting genres', () => {
		expect(() => parseCorrectionChanges({ status: 'approved' })).toThrow('Unsupported');
		for (const coverUrl of [
			'javascript:alert(1)',
			'data:image/svg+xml,test',
			'https://user:pass@example.com/image'
		]) {
			expect(() => parseCorrectionChanges({ coverUrl })).toThrow('HTTP or HTTPS');
		}
		expect(() =>
			parseCorrectionChanges({ genres: { add: ['Fantasy', 'fantasy'], remove: [] } })
		).toThrow('already in the list');
		expect(() =>
			parseCorrectionChanges({ genres: { add: ['Horror'], remove: ['horror'] } })
		).toThrow('added and removed');
	});
	it('enforces text limits at their boundaries', () => {
		for (const field of ['title', 'author']) {
			expect(parseCorrectionChanges({ [field]: 'a'.repeat(200) })).toEqual({
				[field]: 'a'.repeat(200)
			});
			expect(() => parseCorrectionChanges({ [field]: 'a'.repeat(201) })).toThrow('200 characters');
		}
		const prefix = 'https://images.example/';
		const coverUrl = prefix + 'a'.repeat(512 - prefix.length);
		expect(parseCorrectionChanges({ coverUrl })).toEqual({ coverUrl });
		expect(() => parseCorrectionChanges({ coverUrl: coverUrl + 'a' })).toThrow('512 characters');
		expect(
			parseCorrectionChanges({ description: { category: 'other', explanation: 'a'.repeat(600) } })
				.description?.explanation
		).toHaveLength(600);
	});
	it('accepts publication years including BCE and rejects invalid or zero years', () => {
		for (const [input, expected] of [
			['1998', '1998'],
			['0200', '200'],
			['-0300', '-300']
		]) {
			expect(parseCorrectionChanges({ year: input })).toEqual({ year: expected });
		}
		for (const year of ['', '0', '-0', '0000', '2000.5', '20x', '10000', '-10000', 2000]) {
			expect(() => parseCorrectionChanges({ year })).toThrow('valid publication year');
		}
		expect(diffCorrection(original, { ...original, year: '2001' }, 'year')).toEqual({
			year: '2001'
		});
		expect(applyCorrection(original, { year: '2001' }).year).toBe('2001');
	});
	it('bounds new genre labels while permitting removal of old short labels', () => {
		for (const label of ['SF', 'a'.repeat(41)])
			expect(() => parseCorrectionChanges({ genres: { add: [label], remove: [] } })).toThrow(
				'3–40'
			);
		expect(
			parseCorrectionChanges({ genres: { add: ['Art', 'a'.repeat(40)], remove: ['YA'] } })
		).toEqual({ genres: { add: ['Art', 'a'.repeat(40)], remove: ['YA'] } });
	});
});
