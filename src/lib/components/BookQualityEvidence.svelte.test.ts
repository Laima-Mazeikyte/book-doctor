import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BookQualityEvidence from './BookQualityEvidence.svelte';
import type { Book, QualityBand } from '$lib/types/book';

const book: Book = {
	id: 'uuid-book-1',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	title: 'A book',
	author: 'An author'
};

const visibleBands: Array<[QualityBand, string]> = [
	['top_0_1_percent', 'Top 0.1% of catalog'],
	['top_1_percent', 'Top 1% of catalog'],
	['top_5_percent', 'Top 5% of catalog'],
	['top_10_percent', 'Top 10% of catalog'],
	['top_25_percent', 'Top 25% of catalog']
];

it('renders the global catalog label for every visible band', async () => {
	for (const [qualityBand, label] of visibleBands) {
		const rendered = render(BookQualityEvidence, {
			props: { book: { ...book, qualityBand } }
		});

		await expect
			.element(rendered.getByTestId('book-quality-evidence'))
			.toHaveTextContent(`Global catalog standing: ${label}`);
		rendered.unmount();
	}
});

it('renders no distinction for insufficient or below-top-25 evidence', async () => {
	for (const qualityBand of [null, 'below_top_25'] as const) {
		const rendered = render(BookQualityEvidence, {
			props: { book: { ...book, qualityBand, qualityPercentile: 72.15 } }
		});

		expect(document.querySelector('[data-testid="book-quality-evidence"]')).toBeNull();
		rendered.unmount();
	}
});
