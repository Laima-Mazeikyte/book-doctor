import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import BookAnnotations from '$lib/components/books/BookAnnotations.svelte';

it('includes annotation labels as plain text in server HTML without explanations', () => {
	const { body } = render(BookAnnotations, {
		props: {
			book: {
				id: 'ssr-annotations',
				book_id: 'ssr-annotations',
				title: 'Example',
				author: 'An Author',
				characteristics: [{ label: 'Explicit', description: 'Explicit sexual content.' }],
				distinctions: {
					book: { subject: 'book', percent: 1, rank: 42, populationCount: 10000, version: 'v1' },
					author: null
				}
			}
		}
	});
	expect(body).toContain('Explicit');
	expect(body).toContain('Top 1% book');
	expect(body).not.toContain('Explicit sexual content.');
	expect(body).not.toContain('Ranked 42nd best book or series of all time, according to Unread.');
	expect(body).not.toContain('<button');
	expect(body).not.toContain('aria-describedby=');
	expect(body).not.toContain('aria-controls=');
	expect(body).not.toContain('title=');
});
