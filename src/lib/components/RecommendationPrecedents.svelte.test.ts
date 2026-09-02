import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Book } from '$lib/types/book';
import RecommendationPrecedents from './RecommendationPrecedents.svelte';

const books: Book[] = [
	{
		id: 'uuid-book-1',
		book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
		title: 'A book',
		author: 'An author',
		summary: 'A complete summary'
	},
	{
		id: 'uuid-book-2',
		book_id: '01KR2ADTNG29NSQV23VAGV8FXC',
		title: 'Another book',
		author: 'Another author',
		summary: 'Another summary'
	},
	{
		id: 'uuid-book-3',
		book_id: '01KR2ADTNG29NSQV23VAGV8FXD',
		title: 'A third book',
		author: 'A third author',
		summary: 'A third summary'
	},
	{
		id: 'uuid-book-4',
		book_id: '01KR2ADTNG29NSQV23VAGV8FXE',
		title: 'A fourth book',
		author: 'A fourth author',
		summary: 'A fourth summary'
	}
];

it('renders at most three cover buttons and opens the selected book in the summary sheet', async () => {
	const rendered = render(RecommendationPrecedents, { books });

	expect(document.querySelectorAll('.recommendation-precedents__cover-button')).toHaveLength(3);

	await rendered
		.getByRole('button', { name: 'A book by An author. See summary', exact: true })
		.click();
	await expect.element(rendered.getByTestId('book-summary-sheet')).toBeVisible();
	await expect.element(rendered.getByRole('heading', { name: 'A book' })).toBeVisible();

	rendered.unmount();
});
