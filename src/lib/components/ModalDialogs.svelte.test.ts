import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { tick } from 'svelte';
import type { Session } from '@supabase/supabase-js';
import '../../app.css';
import { authStore } from '$lib/stores/auth';
import { runGoodreadsImport, type ImportUiResult } from '$lib/goodreads/runImport';
import { submitBug } from '$lib/bugs/api';
import BugReportModal from './BugReportModal.svelte';
import GoodreadsSyncModal from './GoodreadsSyncModal.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/goodreads/runImport', () => ({ runGoodreadsImport: vi.fn() }));
vi.mock('$lib/bugs/api', () => ({ submitBug: vi.fn() }));

function opener() {
	const button = document.createElement('button');
	button.textContent = 'Open modal';
	button.dataset.modalTestOpener = '';
	document.body.append(button);
	button.focus();
	return button;
}

function mount(Component: typeof BugReportModal | typeof GoodreadsSyncModal) {
	const button = opener();
	const onClose = vi.fn(() => void rendered.rerender({ open: false }));
	const previousOverflow = document.body.style.overflow;
	const rendered: ReturnType<typeof render> = render(Component, { open: true, onClose });
	return { rendered, onClose, button, previousOverflow };
}

async function chooseCsv() {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
	const transfer = new DataTransfer();
	transfer.items.add(
		new File(['Title,Author,Rating\nA book,An author,4'], 'ratings.csv', { type: 'text/csv' })
	);
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
	await tick();
}

describe('modal keyboard and focus behavior', () => {
	beforeEach(() => {
		authStore.setSession({ user: { id: 'modal-user', email: 'reader@example.com' } } as Session);
		vi.mocked(submitBug).mockReset().mockResolvedValue({ error: null });
		vi.mocked(runGoodreadsImport).mockReset();
	});
	afterEach(() => {
		authStore.setSession(null);
		document.querySelectorAll('[data-modal-test-opener]').forEach((node) => node.remove());
	});

	it.each([
		['feedback', BugReportModal],
		['import', GoodreadsSyncModal]
	] as const)(
		'contains forward/backward Tab, blocks background focus, and restores the %s opener on Escape',
		async (_, Component) => {
			const { rendered, onClose, button, previousOverflow } = mount(Component);
			const dialog = rendered.getByRole('dialog');
			await expect.element(dialog).toBeVisible();
			expect(dialog.element().matches(':modal')).toBe(true);
			const close = rendered
				.getByRole('button', { name: 'Close', exact: true })
				.element() as HTMLButtonElement;
			const last =
				Component === BugReportModal
					? rendered.getByRole('button', { name: 'Send feedback', exact: true }).element()
					: document.querySelector('input[type="file"]')!;
			close.focus();
			await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
			expect(document.activeElement).toBe(last);
			await userEvent.keyboard('{Tab}');
			expect(document.activeElement).toBe(close);
			button.focus();
			expect(dialog.element().contains(document.activeElement)).toBe(true);
			await userEvent.keyboard('{Escape}');
			await expect.poll(() => document.querySelector('dialog')).toBeNull();
			expect(onClose).toHaveBeenCalledTimes(1);
			expect(document.activeElement).toBe(button);
			expect(document.body.style.overflow).toBe(previousOverflow);
			await userEvent.keyboard('{Escape}');
			expect(onClose).toHaveBeenCalledTimes(1);
			rendered.unmount();
		}
	);

	it('focuses the feedback textarea initially and handles Escape from inside it', async () => {
		const { rendered, onClose, button } = mount(BugReportModal);
		const input = rendered.getByRole('textbox', { name: 'Message or question' });
		await expect.poll(() => document.activeElement === input.element()).toBe(true);
		await userEvent.keyboard('{Escape}');
		await expect.poll(() => document.activeElement === button).toBe(true);
		expect(onClose).toHaveBeenCalledTimes(1);
		rendered.unmount();
	});

	it('keeps an active import modal when it has no enabled controls, then recovers focus after failure', async () => {
		let finish!: (result: ImportUiResult) => void;
		vi.mocked(runGoodreadsImport).mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			})
		);
		const { rendered, onClose, button } = mount(GoodreadsSyncModal);
		await expect.element(rendered.getByRole('dialog')).toBeVisible();
		await chooseCsv();
		await rendered.getByRole('button', { name: 'Import ratings', exact: true }).click();
		await expect
			.element(rendered.getByRole('button', { name: 'Close', exact: true }))
			.toBeDisabled();
		const dialog = rendered.getByRole('dialog').element();
		await expect.poll(() => dialog.contains(document.activeElement)).toBe(true);
		await userEvent.keyboard('{Tab}{Shift>}{Tab}{/Shift}{Escape}');
		dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onClose).not.toHaveBeenCalled();
		expect(dialog.contains(document.activeElement)).toBe(true);
		finish({ kind: 'error' });
		const close = rendered.getByRole('button', { name: 'Close', exact: true });
		await expect.element(close).toBeEnabled();
		await expect.poll(() => document.activeElement === close.element()).toBe(true);
		await userEvent.keyboard('{Escape}');
		await expect.poll(() => document.activeElement === button).toBe(true);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(runGoodreadsImport).toHaveBeenCalledTimes(1);
		rendered.unmount();
	});

	it('restores an explicit menu trigger when the menu item that opened it disappears', async () => {
		const trigger = opener();
		const item = opener();
		const onClose = () => void rendered.rerender({ open: false });
		const rendered: ReturnType<typeof render> = render(GoodreadsSyncModal, {
			open: true,
			onClose,
			restoreFocusTarget: trigger
		});
		item.remove();
		await expect.element(rendered.getByRole('dialog')).toBeVisible();
		await rendered.getByRole('button', { name: 'Close', exact: true }).click();
		await expect.poll(() => document.activeElement === trigger).toBe(true);
		rendered.unmount();
	});

	it('moves focus to Close when successful feedback replaces the form', async () => {
		const { rendered, button, onClose } = mount(BugReportModal);
		await rendered.getByRole('textbox', { name: 'Message or question' }).fill('A test message');
		await rendered.getByRole('button', { name: 'Send feedback', exact: true }).click();
		await expect
			.element(rendered.getByRole('status'))
			.toHaveTextContent('Thanks for your feedback!');
		expect(document.activeElement).toBe(
			rendered.getByRole('button', { name: 'Close', exact: true }).element()
		);
		expect(submitBug).toHaveBeenCalledTimes(1);
		await expect.poll(() => document.activeElement === button, { timeout: 3000 }).toBe(true);
		expect(onClose).toHaveBeenCalledTimes(1);
		rendered.unmount();
	});
});
