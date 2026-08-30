import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ProminenceAuthorCovers from './ProminenceAuthorCovers.svelte';
import type { AuthorBook } from '$lib/lab/author-prominence/types';

const books: AuthorBook[] = [
	{ bookUlid: '01KR2ADTNG29NSQV23VAGV8FXB', title: 'A book' },
	{ bookUlid: '01KR2ADTNG29NSQV23VAGV8FXC', title: 'Another book' }
];

it('renders real accessible cover buttons and returns the activated book and trigger', async () => {
	const activations: Array<{ book: AuthorBook; trigger: HTMLButtonElement }> = [];
	const rendered = render(ProminenceAuthorCovers, {
		books,
		onOpenBook: (book: AuthorBook, trigger: HTMLButtonElement) =>
			activations.push({ book, trigger })
	});

	const button = rendered.getByRole('button', { name: 'Open A book' });
	await expect.element(button).toBeVisible();
	await button.click();

	expect(activations).toHaveLength(1);
	expect(activations[0].book).toEqual(books[0]);
	expect(activations[0].trigger).toBe(document.querySelector('.prominence-cover__button'));
});
