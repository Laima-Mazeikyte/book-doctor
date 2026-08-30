import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Book } from '$lib/types/book';
import BookSummarySheet from './BookSummarySheet.svelte';
import type { BookSummarySheetState } from './bookSummarySheet';

const book: Book = {
	id: 'uuid-book-1',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	title: 'A book',
	author: 'An author',
	summary: 'A complete summary'
};

function trigger(): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.textContent = 'Open book';
	document.body.append(button);
	return button;
}

it('renders the tagged loading state without fabricating a partial Book', async () => {
	const triggerElement = trigger();
	const state: BookSummarySheetState = {
		kind: 'loading',
		identity: { bookUlid: book.book_id, title: book.title },
		trigger: triggerElement
	};
	const rendered = render(BookSummarySheet, { state, onClose: vi.fn() });

	await expect.element(rendered.getByRole('status')).toBeVisible();
	await expect.element(rendered.getByRole('heading', { name: 'A book' })).toBeVisible();
});

it('renders stable unavailable copy and exposes a translated retry action', async () => {
	const triggerElement = trigger();
	const onRetry = vi.fn();
	const state: BookSummarySheetState = {
		kind: 'error',
		identity: { bookUlid: book.book_id, title: book.title },
		message: 'Book details unavailable. Please try again.',
		trigger: triggerElement
	};
	const rendered = render(BookSummarySheet, { state, onClose: vi.fn(), onRetry });

	const alert = rendered.getByRole('alert');
	await expect.element(alert).toHaveTextContent('Book details unavailable. Please try again.');
	await expect.element(alert).not.toHaveTextContent('PostgREST: permission denied');
	await rendered.getByRole('button', { name: 'Retry', exact: true }).click();
	expect(onRetry).toHaveBeenCalledTimes(1);
});

it('restores focus to the exact activation control after close', async () => {
	const triggerElement = trigger();
	triggerElement.focus();
	let state: BookSummarySheetState = { kind: 'ready', book, trigger: triggerElement };
	const renderedRef: { current?: ReturnType<typeof render> } = {};
	const onClose = vi.fn(() => {
		state = { kind: 'closed' };
		void renderedRef.current?.rerender({ state });
	});
	const rendered = render(BookSummarySheet, { state, onClose });
	renderedRef.current = rendered;

	await rendered.getByRole('button', { name: 'Close summary' }).click();
	await expect.poll(() => document.activeElement === triggerElement).toBe(true);
	expect(onClose).toHaveBeenCalledTimes(1);
});
