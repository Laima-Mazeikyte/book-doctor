import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ShortlistBookDetail from './ShortlistBookDetail.svelte';
import type { Book } from '$lib/types/book';

const book: Book = {
	id: 'uuid-book-1',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	title: 'A book',
	author: 'An author',
	qualityBand: 'top_5_percent'
};

it('renders quality evidence in the top-10 shortlist detail', async () => {
	const rendered = render(ShortlistBookDetail, {
		props: {
			book,
			index: 0,
			setSize: 1,
			bookmarked: false,
			likedBookPrecedents: [],
			authorRelationshipAuthors: [],
			notInterested: false,
			currentRating: null,
			onBookmark: vi.fn(),
			onNotInterested: vi.fn(),
			onRate: vi.fn(),
			onRemoveRating: vi.fn()
		}
	});

	await expect
		.element(rendered.getByTestId('book-quality-evidence'))
		.toHaveTextContent('Global catalog standing: Top 5% of catalog');
	rendered.unmount();
});
