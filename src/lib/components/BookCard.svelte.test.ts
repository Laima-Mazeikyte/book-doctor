import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BookCard from './BookCard.svelte';

const appPage = vi.hoisted(() => ({
	current: { state: {} as Record<string, unknown> }
}));

vi.mock('$app/stores', () => ({
	page: {
		subscribe(run: (value: typeof appPage.current) => void) {
			run(appPage.current);
			return () => undefined;
		}
	}
}));

vi.mock('$app/navigation', () => ({
	pushState(url: string, state: Record<string, unknown>) {
		appPage.current = { state };
		window.history.pushState(state, '', url);
	},
	replaceState(url: string, state: Record<string, unknown>) {
		appPage.current = { state };
		window.history.replaceState(state, '', url);
	},
	goto: vi.fn()
}));

const book = {
	id: 'uuid-book-1',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	title: 'A book',
	author: 'An author',
	summary: 'A complete summary'
};

it('opens the extracted canonical summary sheet without rate-only history', async () => {
	const historyLength = window.history.length;
	const rendered = render(BookCard, {
		props: {
			book,
			context: 'recommendations',
			onRate: vi.fn(),
			onRemoveRating: vi.fn()
		}
	});

	await rendered
		.getByRole('button', { name: 'A book by An author. See summary', exact: true })
		.first()
		.click();
	await expect.element(rendered.getByTestId('book-summary-sheet')).toBeVisible();
	await expect.element(rendered.getByRole('heading', { name: 'A book' })).toBeVisible();
	expect(window.history.length).toBe(historyLength);
	expect(window.history.state?.bookSummarySheet).toBeUndefined();
	rendered.unmount();
});

it('strips its owned shallow marker when a rate card is removed', async () => {
	appPage.current = { state: {} };
	const historyLength = window.history.length;
	const rendered = render(BookCard, {
		props: {
			book,
			context: 'rate',
			onRate: vi.fn(),
			onRemoveRating: vi.fn()
		}
	});

	await rendered
		.getByRole('button', { name: 'A book by An author. See summary', exact: true })
		.first()
		.click();
	await expect.element(rendered.getByTestId('book-summary-sheet')).toBeVisible();
	expect(window.history.length).toBe(historyLength + 1);
	expect(window.history.state?.bookSummarySheet).toEqual({
		ownerId: expect.any(String),
		bookUlid: book.book_id
	});

	rendered.unmount();
	await expect.poll(() => window.history.state?.bookSummarySheet).toBeUndefined();
	expect(window.history.length).toBe(historyLength + 1);

	window.history.back();
	appPage.current = { state: {} };
});
