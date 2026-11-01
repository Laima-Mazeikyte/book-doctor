import { expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { normalizeAwards } from '$lib/books/annotations';
import BookAwards from './BookAwards.svelte';

it('omits empty award sections and keeps valid entries alongside malformed ones', async () => {
	for (const awards of [null, [], undefined]) {
		const screen = render(BookAwards, { awards });
		expect(document.querySelector('.book-awards')).toBeNull();
		screen.unmount();
	}
	const screen = render(BookAwards, {
		awards: [
			{ tier: 1, name: 'Award', status: 'winner', year: null },
			{ tier: 9, name: 'Bad', status: 'winner', year: 2020 }
		]
	});
	await expect.element(screen.getByRole('heading', { name: 'Awards', exact: true })).toBeVisible();
	await expect.element(screen.getByText('Award', { exact: true })).toBeVisible();
	expect(document.querySelectorAll('.book-awards li')).toHaveLength(1);
	expect(document.querySelector('.award-detail')?.textContent).toBe('Winner');
	screen.unmount();
});

it('shows the first six awards by importance and expands or collapses the full list', async () => {
	for (const count of [1, 6, 7, 40]) {
		const awards = Array.from({ length: count }, (_, i) => ({
			tier: (i % 5) + 1,
			name: `Example Award ${i}`,
			status: i % 2 ? 'nominee' : 'winner',
			year: i % 3 ? 2024 : null
		}));
		const screen = render(BookAwards, { awards });
		const names = () =>
			Array.from(document.querySelectorAll('.book-awards .award-name'), (el) => el.textContent);
		const expected = normalizeAwards(awards).map((award) => award.name);
		expect(names()).toEqual(expected.slice(0, 6));
		expect(document.querySelector('.book-awards')?.textContent).not.toMatch(/Awarded to|Tier/);
		if (count > 6) {
			const expand = screen.getByRole('button', { name: `Show all ${count} awards` });
			await expect.element(expand).toHaveAttribute('aria-expanded', 'false');
			await expand.click();
			expect(names()).toEqual(expected);
			const collapse = screen.getByRole('button', { name: 'Show fewer awards' });
			await expect.element(collapse).toHaveAttribute('aria-expanded', 'true');
			await collapse.click();
			expect(names()).toEqual(expected.slice(0, 6));
		} else {
			expect(document.querySelector('.book-awards button')).toBeNull();
		}
		screen.unmount();
	}
});

it('starts collapsed when a different book supplies a new award list', async () => {
	const awards = Array.from({ length: 8 }, (_, i) => ({
		tier: 1,
		name: `Award ${i}`,
		status: 'winner',
		year: 2024
	}));
	const screen = render(BookAwards, { awards });
	await screen.getByRole('button', { name: 'Show all 8 awards' }).click();
	expect(document.querySelectorAll('.book-awards li')).toHaveLength(8);
	await screen.rerender({ awards: [...awards] });
	expect(document.querySelectorAll('.book-awards li')).toHaveLength(6);
	screen.unmount();
});

it('wraps long award names in wide and narrow layouts without horizontal overflow', async () => {
	const awards = Array.from({ length: 10 }, (_, i) => ({
		tier: 1,
		name: `A long award name ${i} ${'LongName'.repeat(15)}`,
		status: 'winner',
		year: 2024
	}));
	try {
		for (const [width, columns] of [
			[390, 1],
			[850, 2]
		]) {
			await page.viewport(width, 900);
			const screen = render(BookAwards, { awards });
			await expect
				.element(screen.getByRole('heading', { name: 'Awards', exact: true }))
				.toBeVisible();
			const list = document.querySelector('.book-awards ul')!;
			(list.parentElement as HTMLElement).style.maxWidth = '600px';
			expect(getComputedStyle(list).gridTemplateColumns.split(' ').length).toBe(columns);
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
			await screen.getByRole('button', { name: 'Show all 10 awards' }).click();
			expect(document.querySelectorAll('.book-awards li')).toHaveLength(10);
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
			screen.unmount();
		}
	} finally {
		await page.viewport(1280, 900);
	}
});
