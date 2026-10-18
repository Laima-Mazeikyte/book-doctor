import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { userEvent } from 'vitest/browser';
import '../../../app.css';
import coverPreviewFixture from '$lib/assets/favicon.svg?url';
import type { Session } from '@supabase/supabase-js';
import { authStore } from '$lib/stores/auth';
import { CorrectionRequestError } from '$lib/corrections/errors';
import type {
	CorrectionChanges,
	CorrectionContext,
	CorrectionField,
	CorrectionValues,
	PendingCorrection
} from '$lib/corrections/model';
import type { Book } from '$lib/types/book';

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), withdraw: vi.fn() }));
vi.mock('$lib/corrections/api', () => ({
	loadCorrectionContext: api.load,
	saveCorrection: api.save,
	withdrawCorrection: api.withdraw
}));
import BookCorrection from './BookCorrection.svelte';
const book: Book = {
	id: 'uuid',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	title: 'Original title',
	author: 'Original author',
	year: '1998',
	summary: 'Original description',
	genres: ['Fantasy']
};
const values: CorrectionValues = {
	title: book.title,
	author: book.author,
	year: book.year!,
	summary: book.summary!,
	genres: ['Fantasy'],
	coverUrl: 'https://covers.example/original.jpg'
};
let context: CorrectionContext;
function register(anonymous = false) {
	authStore.setSession({
		user: { id: 'user-1', is_anonymous: anonymous },
		access_token: 'token'
	} as Session);
}
function proposal(field: CorrectionField, changes: CorrectionChanges): PendingCorrection {
	return {
		id: field + '-pending',
		field,
		original_values: structuredClone(values),
		proposed_changes: changes,
		submitted_at: '2026-10-17T12:00:00Z',
		review_due_at: '2026-10-18T12:00:00Z'
	};
}
async function openField(rendered: ReturnType<typeof render>, label: string) {
	await rendered
		.getByRole('button', { name: /^(Suggest a correction|View your proposed changes)$/ })
		.click();
	await rendered.getByRole('button', { name: label, exact: true }).click();
	await expect
		.element(rendered.getByRole('button', { name: label, exact: true }))
		.not.toBeInTheDocument();
}
beforeEach(() => {
	vi.resetAllMocks();
	context = { catalog: structuredClone(values), pending: [], remaining: 20, resetsAt: null };
	api.load.mockImplementation(async () => structuredClone(context));
	api.withdraw.mockImplementation(async (_book: string, id: string) => {
		context = { ...context, pending: context.pending.filter((p) => p.id !== id) };
	});
	api.save.mockImplementation(async (_book: string, id: string, changes: CorrectionChanges) => {
		const existing = context.pending.find((p) => p.id === id);
		const field = Object.keys(changes)[0] as CorrectionField;
		const next = {
			...proposal(field, changes),
			id,
			original_values: existing?.original_values ?? structuredClone(context.catalog)
		};
		context = {
			...context,
			remaining: context.remaining - (existing ? 0 : 1),
			pending: [...context.pending.filter((p) => p.id !== id), next]
		};
		return structuredClone(context);
	});
	register();
});
afterEach(async () => {
	authStore.setSession(null);
	await tick();
	document.querySelectorAll('[data-correction-scroll-fixture]').forEach((node) => node.remove());
});

it('hides corrections from anonymous and signed-out users', async () => {
	authStore.setSession(null);
	const rendered = render(BookCorrection, { book });
	await expect
		.element(rendered.getByRole('button', { name: 'Suggest a correction' }))
		.not.toBeInTheDocument();
	register(true);
	await expect
		.element(rendered.getByRole('button', { name: 'Suggest a correction' }))
		.not.toBeInTheDocument();
	expect(api.load).not.toHaveBeenCalled();
});
it('starts with a field picker without exposing book data or review copy', async () => {
	const rendered = render(BookCorrection, { book });
	await rendered.getByRole('button', { name: 'Suggest a correction', exact: true }).click();
	for (const name of [
		'Title',
		'Author',
		'Publication year',
		'Description',
		'Cover image',
		'Genres'
	])
		await expect.element(rendered.getByRole('button', { name, exact: true })).toBeVisible();
	await expect.element(rendered.getByRole('textbox')).not.toBeInTheDocument();
	await expect
		.element(rendered.getByText('What would you like to change?', { exact: true }))
		.not.toBeInTheDocument();
	await expect.element(rendered.getByText(book.title, { exact: true })).not.toBeInTheDocument();
	await expect
		.element(rendered.getByText(/reviewed within 24 hours|20 corrections|another change/))
		.not.toBeInTheDocument();
});
it('edits and records only the selected field, with confirmation after submission', async () => {
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Title');
	await expect
		.element(rendered.getByRole('textbox', { name: 'Author', exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(rendered.getByPlaceholder('Search genres or enter a new label'))
		.not.toBeInTheDocument();
	await rendered.getByRole('textbox', { name: 'Title', exact: true }).fill('Corrected title');
	await rendered.getByRole('button', { name: 'Propose changes', exact: true }).click();
	await expect
		.element(rendered.getByRole('status'))
		.toHaveTextContent('Your proposal will be reviewed within 24 hours. Thank you!');
	expect(api.save).toHaveBeenCalledExactlyOnceWith(book.book_id, expect.any(String), {
		title: 'Corrected title'
	});
	expect(book.title).toBe('Original title');
	await openField(rendered, 'Title');
	await expect
		.element(rendered.getByRole('textbox', { name: 'Title', exact: true }))
		.toHaveValue('Corrected title');
});
it('returns from the field heading to the picker and restores focus to that field', async () => {
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Publication year');
	await expect.element(rendered.getByRole('heading', { name: 'Publication year' })).toBeVisible();
	await expect
		.element(rendered.getByRole('heading', { name: 'Suggest a correction', exact: true }))
		.not.toBeInTheDocument();
	await rendered.getByRole('button', { name: 'Choose another field', exact: true }).click();
	await expect
		.element(rendered.getByRole('button', { name: 'Publication year', exact: true }))
		.toHaveFocus();
	await expect.element(rendered.getByRole('textbox')).not.toBeInTheDocument();
});
it('keeps the warm picker visible during refresh and protects a draft from a late response', async () => {
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Title');
	await rendered.getByRole('button', { name: 'Choose another field', exact: true }).click();
	await rendered.getByRole('button', { name: 'Close', exact: true }).click();
	let finish!: (value: CorrectionContext) => void;
	const response = new Promise<CorrectionContext>((resolve) => (finish = resolve));
	api.load.mockReturnValueOnce(response);
	await rendered.getByRole('button', { name: 'Suggest a correction', exact: true }).click();
	await expect.element(rendered.getByRole('button', { name: 'Title', exact: true })).toBeVisible();
	await expect
		.element(rendered.getByText('Loading book details', { exact: false }))
		.not.toBeInTheDocument();
	await rendered.getByRole('button', { name: 'Title', exact: true }).click();
	await rendered.getByRole('textbox', { name: 'Title', exact: true }).fill('Keep this draft');
	finish({
		...structuredClone(context),
		pending: [proposal('title', { title: 'Saved elsewhere' })]
	});
	await response;
	await tick();
	await expect
		.element(rendered.getByRole('textbox', { name: 'Title', exact: true }))
		.toHaveValue('Keep this draft');
	await expect
		.element(rendered.getByRole('button', { name: 'Propose changes', exact: true }))
		.toBeEnabled();
});
it('preserves separate drafts on Back and clears them only when the flow is closed', async () => {
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Author');
	await expect
		.element(rendered.getByRole('button', { name: 'Cancel', exact: true }))
		.not.toBeInTheDocument();
	await rendered.getByRole('textbox', { name: 'Author', exact: true }).fill('Draft author');
	await rendered.getByRole('button', { name: 'Choose another field' }).click();
	await rendered.getByRole('button', { name: 'Description', exact: true }).click();
	await rendered.getByText('Spoiler', { exact: true }).click();
	await rendered
		.getByLabelText('In brief, what is wrong with the description?')
		.fill('Reveals the ending.');
	await rendered.getByRole('button', { name: 'Choose another field' }).click();
	await rendered.getByRole('button', { name: 'Author', exact: true }).click();
	await expect
		.element(rendered.getByRole('textbox', { name: 'Author', exact: true }))
		.toHaveValue('Draft author');
	await rendered.getByRole('button', { name: 'Choose another field' }).click();
	await rendered.getByRole('button', { name: 'Description', exact: true }).click();
	await expect.element(rendered.getByRole('radio', { name: 'Spoiler', exact: true })).toBeChecked();
	await expect
		.element(rendered.getByLabelText('In brief, what is wrong with the description?'))
		.toHaveValue('Reveals the ending.');
	await rendered.getByRole('button', { name: 'Choose another field' }).click();
	await rendered.getByRole('button', { name: 'Close', exact: true }).click();
	await openField(rendered, 'Author');
	await expect
		.element(rendered.getByRole('textbox', { name: 'Author', exact: true }))
		.toHaveValue(values.author);
	expect(api.save).not.toHaveBeenCalled();
	expect(api.withdraw).not.toHaveBeenCalled();
});

function scrollFixture() {
	const scroller = document.createElement('div');
	scroller.dataset.correctionScrollFixture = '';
	scroller.style.cssText =
		'height: 320px; width: 350px; overflow-y: auto; position: relative; padding: 16px; overflow-anchor: auto;';
	const spacer = document.createElement('div');
	spacer.style.height = '600px';
	scroller.append(spacer);
	document.body.append(scroller);
	const rendered = render(BookCorrection, { book });
	scroller.append(rendered.container);
	const after = document.createElement('div');
	after.style.height = '160px';
	scroller.append(after);
	return { scroller, rendered };
}

it('keeps the footer and panel bottom anchored when Back expands a short field into the picker', async () => {
	const { scroller, rendered } = scrollFixture();
	await openField(rendered, 'Author');
	const panel = rendered.container.querySelector('.correction__panel') as HTMLElement;
	const footer = rendered.container.querySelector('.correction__actions') as HTMLElement;
	await expect.poll(() => panel.getAnimations({ subtree: true }).length).toBe(0);
	const panelBottom = panel.getBoundingClientRect().bottom;
	const footerBottom = footer.getBoundingClientRect().bottom;
	const scrollBefore = scroller.scrollTop;
	await rendered.getByRole('button', { name: 'Choose another field' }).click();
	await expect.poll(() => panel.getAnimations({ subtree: true }).length).toBe(0);
	await expect
		.poll(() => Math.abs(panel.getBoundingClientRect().bottom - panelBottom))
		.toBeLessThan(2);
	expect(Math.abs(footer.getBoundingClientRect().bottom - footerBottom)).toBeLessThan(2);
	expect(scroller.scrollTop).toBeGreaterThan(scrollBefore);
	await expect.element(rendered.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
	await rendered.getByRole('button', { name: 'Close', exact: true }).click();
	expect(scroller.style.overflowAnchor).toBe('auto');
});

it('reserves the cover preview size and keeps submission visible as it appears', async () => {
	const { scroller, rendered } = scrollFixture();
	await openField(rendered, 'Cover image');
	const panel = rendered.container.querySelector('.correction__panel') as HTMLElement;
	const footer = rendered.container.querySelector('.correction__actions') as HTMLElement;
	await expect.poll(() => panel.getAnimations({ subtree: true }).length).toBe(0);
	await rendered
		.getByRole('textbox', { name: 'Cover image', exact: true })
		.fill(new URL(coverPreviewFixture, location.href).href);
	const bottom = footer.getBoundingClientRect().bottom;
	await rendered.getByRole('button', { name: 'Preview cover', exact: true }).click();
	await expect.poll(() => panel.getAnimations({ subtree: true }).length).toBe(0);
	await expect.poll(() => Math.abs(footer.getBoundingClientRect().bottom - bottom)).toBeLessThan(2);
	const cover = rendered.getByRole('img', { name: 'Proposed cover image' }).element();
	expect(cover.getBoundingClientRect().height).toBe(150);
	expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(
		scroller.getBoundingClientRect().bottom
	);
	await expect
		.element(rendered.getByRole('button', { name: 'Propose changes', exact: true }))
		.toBeVisible();
});

it('scrolls the actions with the menu when the user scrolls up through a long description', async () => {
	context.catalog.summary = 'A long description. '.repeat(150);
	const { scroller, rendered } = scrollFixture();
	await openField(rendered, 'Description');
	const panel = rendered.container.querySelector('.correction__panel') as HTMLElement;
	const footer = rendered.container.querySelector('.correction__actions') as HTMLElement;
	await expect.poll(() => panel.getAnimations({ subtree: true }).length).toBe(0);
	const footerBottom = footer.getBoundingClientRect().bottom;
	const panelOffset = panel.getBoundingClientRect().bottom - footerBottom;
	scroller.scrollTop -= 100;
	await expect.poll(() => footer.getBoundingClientRect().bottom - footerBottom).toBeGreaterThan(90);
	expect(footer.getBoundingClientRect().bottom - footerBottom).toBeLessThan(110);
	expect(panel.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom).toBeCloseTo(
		panelOffset
	);
	expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
});
it('keeps a successful proposal when an older background refresh finishes later', async () => {
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Title');
	await rendered.getByRole('button', { name: 'Choose another field', exact: true }).click();
	await rendered.getByRole('button', { name: 'Close', exact: true }).click();
	const stale = structuredClone(context);
	let finish!: (value: CorrectionContext) => void;
	const response = new Promise<CorrectionContext>((resolve) => (finish = resolve));
	api.load.mockReturnValueOnce(response);
	await openField(rendered, 'Title');
	await rendered.getByRole('textbox', { name: 'Title', exact: true }).fill('Saved proposal');
	await rendered.getByRole('button', { name: 'Propose changes', exact: true }).click();
	await expect.element(rendered.getByRole('status')).toHaveTextContent('Thank you!');
	finish(stale);
	await response;
	await tick();
	await expect
		.element(rendered.getByRole('button', { name: 'View your proposed changes' }))
		.toBeVisible();
});
it('collects an issue category and explanation without editing the description', async () => {
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Description');
	await expect.element(rendered.getByText(values.summary, { exact: true })).toBeVisible();
	await expect.element(rendered.getByText('Description', { exact: true })).toBeVisible();
	await expect.element(rendered.getByRole('textbox')).toHaveValue('');
	for (const name of ['Factual error', 'Spoiler', 'Too generic', 'Other'])
		await expect.element(rendered.getByRole('radio', { name, exact: true })).not.toBeChecked();
	await rendered.getByRole('button', { name: 'Propose changes', exact: true }).click();
	await expect
		.element(rendered.getByRole('alert'))
		.toHaveTextContent('Please provide a short description of the problem.');
	await expect
		.element(rendered.getByRole('button', { name: 'Reload proposal', exact: true }))
		.not.toBeInTheDocument();
	await rendered
		.getByLabelText('In brief, what is wrong with the description?')
		.fill('The description could apply to any fantasy book.');
	await rendered.getByRole('button', { name: 'Propose changes', exact: true }).click();
	await expect
		.element(rendered.getByRole('alert'))
		.toHaveTextContent('Please select the type of problem.');
	expect(api.save).not.toHaveBeenCalled();
	await rendered.getByText('Too generic', { exact: true }).click();
	await userEvent.keyboard('{ArrowRight}');
	await expect.element(rendered.getByRole('radio', { name: 'Other', exact: true })).toBeChecked();
	await userEvent.keyboard('{ArrowLeft}');
	await expect.element(rendered.getByRole('radio', { name: 'Too generic' })).toBeChecked();
	await rendered.getByRole('button', { name: 'Propose changes', exact: true }).click();
	await expect.element(rendered.getByRole('status')).toHaveTextContent('Thank you!');
	expect(api.save).toHaveBeenCalledWith(book.book_id, expect.any(String), {
		description: {
			category: 'too_generic',
			explanation: 'The description could apply to any fantasy book.'
		}
	});
	expect(context.catalog.summary).toBe(values.summary);
});
it('keeps different fields on the same book as separate proposals', async () => {
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Title');
	await rendered.getByRole('textbox', { name: 'Title', exact: true }).fill('Correct title');
	await rendered.getByRole('button', { name: 'Propose changes', exact: true }).click();
	await openField(rendered, 'Author');
	await rendered.getByRole('textbox', { name: 'Author', exact: true }).fill('Correct author');
	await rendered.getByRole('button', { name: 'Propose changes', exact: true }).click();
	await expect.element(rendered.getByRole('status')).toHaveTextContent('Thank you!');
	expect(context.pending.map((p) => p.field).sort()).toEqual(['author', 'title']);
	expect(context.remaining).toBe(18);
});
it('allows revisions at the rolling limit and preserves the other fields when withdrawing', async () => {
	context.remaining = 0;
	context.resetsAt = '2026-10-18T12:00:00Z';
	context.pending = [
		proposal('author', { author: 'Proposed author' }),
		proposal('genres', { genres: { add: ['Solar Gothic'], remove: ['Fantasy'] } })
	];
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Genres');
	await expect
		.element(rendered.getByRole('button', { name: 'Update proposed changes' }))
		.toBeEnabled();
	await rendered.getByRole('button', { name: 'Remove Solar Gothic', exact: true }).click();
	await rendered.getByPlaceholder('Search genres or enter a new label').fill('Fantasy');
	await rendered.getByRole('button', { name: 'Add genre', exact: true }).click();
	await rendered.getByRole('button', { name: 'Update proposed changes', exact: true }).click();
	await expect
		.element(rendered.getByRole('status'))
		.toHaveTextContent('Your change proposal has been withdrawn.');
	expect(api.withdraw).toHaveBeenCalledExactlyOnceWith(book.book_id, 'genres-pending');
	expect(context.pending.map((p) => p.field)).toEqual(['author']);
	expect(context.remaining).toBe(0);
	expect(api.save).not.toHaveBeenCalled();
	await openField(rendered, 'Author');
	await expect
		.element(rendered.getByRole('textbox', { name: 'Author', exact: true }))
		.toHaveValue('Proposed author');
});
it('retries withdrawal when a reverted pending field fails to save', async () => {
	context.pending = [proposal('author', { author: 'Proposed author' })];
	api.withdraw.mockRejectedValueOnce(new Error('Could not withdraw. Try again.'));
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Author');
	await rendered.getByRole('textbox', { name: 'Author', exact: true }).fill(values.author);
	await rendered.getByRole('button', { name: 'Update proposed changes', exact: true }).click();
	await expect.element(rendered.getByRole('alert')).toHaveTextContent('Could not withdraw');
	await expect
		.element(rendered.getByRole('textbox', { name: 'Author', exact: true }))
		.toHaveValue(values.author);
	await rendered.getByRole('button', { name: 'Update proposed changes', exact: true }).click();
	await expect
		.element(rendered.getByRole('status'))
		.toHaveTextContent('Your change proposal has been withdrawn.');
	expect(api.withdraw).toHaveBeenCalledTimes(2);
});
it('blocks new fields after twenty corrections and shows the next available time', async () => {
	context.remaining = 0;
	context.resetsAt = '2026-10-18T12:00:00Z';
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Title');
	await expect
		.element(rendered.getByRole('button', { name: 'Propose changes', exact: true }))
		.toBeDisabled();
	await expect
		.element(rendered.getByRole('status'))
		.toHaveTextContent('20 corrections in 24 hours');
	await expect.element(rendered.getByRole('status')).toHaveTextContent('another change');
	expect(api.save).not.toHaveBeenCalled();
});
it('keeps failed drafts and clears private data on sign-out', async () => {
	api.save.mockRejectedValue(new Error('Could not save. Try again.'));
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Title');
	await rendered.getByRole('textbox', { name: 'Title', exact: true }).fill('Keep this draft');
	await rendered.getByRole('button', { name: 'Propose changes', exact: true }).click();
	await expect.element(rendered.getByRole('alert')).toHaveTextContent('Could not save');
	await expect
		.element(rendered.getByRole('button', { name: 'Reload proposal', exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(rendered.getByRole('textbox', { name: 'Title', exact: true }))
		.toHaveValue('Keep this draft');
	authStore.setSession(null);
	await expect
		.element(rendered.getByRole('textbox', { name: 'Title', exact: true }))
		.not.toBeInTheDocument();
});

it('saves publication-year corrections separately and withdraws a reverted year', async () => {
	context.catalog.year = '1965';
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Publication year');
	await expect
		.element(rendered.getByRole('textbox', { name: 'Publication year', exact: true }))
		.toHaveValue('1965');
	await rendered.getByRole('textbox', { name: 'Publication year', exact: true }).fill('2001');
	await rendered.getByRole('button', { name: 'Propose changes', exact: true }).click();
	await expect.element(rendered.getByRole('status')).toHaveTextContent('Thank you!');
	expect(api.save).toHaveBeenCalledWith(book.book_id, expect.any(String), { year: '2001' });
	await openField(rendered, 'Publication year');
	await rendered.getByRole('textbox', { name: 'Publication year', exact: true }).fill('1965');
	await rendered.getByRole('button', { name: 'Update proposed changes', exact: true }).click();
	await expect
		.element(rendered.getByRole('status'))
		.toHaveTextContent('Your change proposal has been withdrawn.');
	expect(api.withdraw).toHaveBeenCalledTimes(1);
});

it.each([
	['Title', 'Please enter the corrected title.'],
	['Author', 'Please enter the corrected author name.'],
	['Publication year', 'Please enter the correct publication year.'],
	['Cover image', 'Please provide a link to a different cover image.'],
	['Genres', 'Please add or remove a genre.']
])(
	'gives a useful message for an unchanged %s without a reload action',
	async (field, expected) => {
		const rendered = render(BookCorrection, { book });
		await openField(rendered, field);
		await rendered.getByRole('button', { name: 'Propose changes', exact: true }).click();
		await expect.element(rendered.getByRole('alert')).toHaveTextContent(expected);
		await expect
			.element(rendered.getByRole('button', { name: 'Reload proposal', exact: true }))
			.not.toBeInTheDocument();
		expect(api.save).not.toHaveBeenCalled();
	}
);

it('offers reload only when the saved proposal has changed on the server', async () => {
	api.save.mockRejectedValue(new CorrectionRequestError('This proposal has changed.', 409));
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Title');
	await rendered.getByRole('textbox', { name: 'Title', exact: true }).fill('Unsaved draft');
	await rendered.getByRole('button', { name: 'Propose changes', exact: true }).click();
	await expect.element(rendered.getByRole('alert')).toHaveTextContent('This proposal has changed.');
	context.pending = [proposal('title', { title: 'Saved elsewhere' })];
	await rendered.getByRole('button', { name: 'Reload proposal', exact: true }).click();
	await expect
		.element(rendered.getByRole('textbox', { name: 'Title', exact: true }))
		.toHaveValue('Saved elsewhere');
});

it('offers a loading retry when book details could not be loaded', async () => {
	api.load.mockRejectedValue(new Error('Could not load.'));
	const rendered = render(BookCorrection, { book });
	await rendered.getByRole('button', { name: 'Suggest a correction', exact: true }).click();
	await expect.element(rendered.getByRole('alert')).toHaveTextContent('Could not load.');
	api.load.mockResolvedValue(structuredClone(context));
	await rendered.getByRole('button', { name: 'Try loading again', exact: true }).click();
	await expect
		.element(rendered.getByRole('button', { name: 'Publication year', exact: true }))
		.toBeVisible();
});
it('locks genre entry at ten and re-enables it after removal', async () => {
	context.catalog.genres = Array.from({ length: 10 }, (_, i) => 'Niche ' + i);
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Genres');
	await expect
		.element(rendered.getByPlaceholder('Search genres or enter a new label'))
		.toBeDisabled();
	await expect
		.element(rendered.getByRole('button', { name: 'Add genre', exact: true }))
		.toBeDisabled();
	await expect.element(rendered.getByText('Up to 10 genres', { exact: true })).toBeVisible();
	await rendered.getByRole('button', { name: 'Remove Niche 0', exact: true }).click();
	await expect
		.element(rendered.getByPlaceholder('Search genres or enter a new label'))
		.toBeEnabled();
	await expect
		.element(rendered.getByText('Up to 10 genres', { exact: true }))
		.not.toBeInTheDocument();
});
it('enforces the genre bounds and escapes HTML-like niche labels', async () => {
	const rendered = render(BookCorrection, { book });
	await openField(rendered, 'Genres');
	await rendered.getByPlaceholder('Search genres or enter a new label').fill('SF');
	await rendered.getByRole('button', { name: 'Add genre', exact: true }).click();
	await expect.element(rendered.getByRole('alert')).toHaveTextContent('3–40');
	const label = '<img src=x onerror=alert(1)>';
	await rendered.getByPlaceholder('Search genres or enter a new label').fill(label);
	await rendered.getByRole('button', { name: 'Add genre', exact: true }).click();
	await expect.element(rendered.getByText(label, { exact: true })).toBeVisible();
	expect(document.querySelector('.correction img[src="x"]')).toBeNull();
});
