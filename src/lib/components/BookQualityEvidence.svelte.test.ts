import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BookQualityEvidence from './BookQualityEvidence.svelte';
import type { Book } from '$lib/types/book';
const book: Book = { id: 'uuid', book_id: 'ulid', title: 'Book', author: 'Author' };
it('uses the shared stored book and author badges in the drawer renderer', async () => {
	const screen = render(BookQualityEvidence, {
		book: {
			...book,
			distinctions: {
				book: { percent: 1, subject: 'book', rank: 10, populationCount: 1000, version: 'v1' },
				author: { percent: 10, subject: 'author', rank: 100, populationCount: 1000, version: 'v1' }
			}
		}
	});
	await expect.element(screen.getByText('Top 1% book', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Top 10% Author', { exact: true })).toBeVisible();
	expect(document.querySelector('[data-testid="book-annotations"]')?.textContent).not.toContain(
		'Global catalog'
	);
	screen.unmount();
});
it('does not fall back to the old quality band when stored annotations are missing', () => {
	const screen = render(BookQualityEvidence, { book: { ...book, qualityBand: 'top_1_percent' } });
	expect(document.querySelector('[data-testid="book-annotations"]')).toBeNull();
	screen.unmount();
});
