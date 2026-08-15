import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ConnectionAperture from './ConnectionAperture.svelte';

it('exposes the five-to-fifty aperture and preset shortcuts', async () => {
	const changes: number[] = [];
	const rendered = render(ConnectionAperture, {
		value: 10,
		visibleCount: 10,
		mappedCount: 10,
		onChange: (value: number) => {
			changes.push(value);
			void rendered.rerender({ value });
		}
	});

	await rendered.getByRole('button', { name: 'Connections' }).click();
	expect(document.querySelector('.connection-aperture__trigger')?.textContent).not.toContain('10');
	expect(document.body.textContent).not.toContain('Showing 10 of 342 significant relationships.');
	const slider = rendered.getByRole('slider', { name: 'Connections shown' });
	await expect.element(slider).toHaveAttribute('min', '5');
	await expect.element(slider).toHaveAttribute('max', '50');
	await expect.element(slider).toHaveAttribute('aria-valuenow', '10');
	await expect
		.poll(() => document.activeElement === document.querySelector('.connection-aperture__slider'))
		.toBe(true);

	await rendered.getByRole('button', { name: '30', exact: true }).click();
	await expect.element(slider).toHaveAttribute('aria-valuenow', '30');
	expect(changes).toEqual([30]);
});

it('uses five-step page-key increments and closes before page escape', async () => {
	const changes: number[] = [];
	const rendered = render(ConnectionAperture, {
		value: 20,
		visibleCount: 6,
		mappedCount: 6,
		onChange: (value: number) => {
			changes.push(value);
			void rendered.rerender({ value });
		}
	});

	await rendered.getByRole('button', { name: 'Connections' }).click();
	const slider = rendered.getByRole('slider', { name: 'Connections shown' });
	const sliderElement = document.querySelector<HTMLInputElement>('.connection-aperture__slider');
	if (!sliderElement) throw new Error('The aperture slider was not rendered.');
	sliderElement.focus();
	sliderElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	await expect.element(slider).toHaveAttribute('aria-valuenow', '15');
	expect(changes).toEqual([15]);
	await new Promise((resolve) => setTimeout(resolve, 300));
	expect(document.querySelector('.connection-aperture__announcement')?.textContent).toContain(
		'up to 15 relationships'
	);

	sliderElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	await expect
		.poll(() => document.activeElement?.classList.contains('connection-aperture__trigger'))
		.toBe(true);
});
