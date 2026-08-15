<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { t } from '$lib/copy';

	interface Props {
		value: number;
		visibleCount: number;
		mappedCount: number;
		onChange: (value: number) => void;
	}

	const MIN = 5;
	const MAX = 50;
	const PRESETS = [5, 10, 20, 30, 50];

	let { value, visibleCount, mappedCount, onChange }: Props = $props();

	let rootEl: HTMLDivElement | null = $state(null);
	let triggerEl: HTMLButtonElement | null = $state(null);
	let sliderEl: HTMLInputElement | null = $state(null);
	let open = $state(false);
	let announcement = $state('');
	let frame: number | null = null;
	let pendingValue: number | null = null;
	let announcementTimer: ReturnType<typeof setTimeout> | null = null;

	function clamp(next: number): number {
		return Math.max(MIN, Math.min(MAX, Math.round(next)));
	}

	function scheduleAnnouncement(next: number): void {
		if (announcementTimer !== null) clearTimeout(announcementTimer);
		announcementTimer = setTimeout(() => {
			announcement = t('lab.authorConnections.browse.aperture.announcement', { count: next });
			announcementTimer = null;
		}, 250);
	}

	function flushPending(): void {
		frame = null;
		if (pendingValue === null) return;
		const next = pendingValue;
		pendingValue = null;
		onChange(next);
		scheduleAnnouncement(next);
	}

	function schedule(next: number): void {
		pendingValue = clamp(next);
		if (frame !== null) return;
		frame = requestAnimationFrame(flushPending);
	}

	function commit(next: number): void {
		if (frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
		pendingValue = null;
		const clamped = clamp(next);
		onChange(clamped);
		scheduleAnnouncement(clamped);
	}

	function handleInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		schedule(Number(input.value));
	}

	function handleSliderKeydown(event: KeyboardEvent): void {
		if (event.key !== 'PageDown' && event.key !== 'PageUp') return;
		event.preventDefault();
		const input = event.currentTarget as HTMLInputElement;
		schedule(Number(input.value) + (event.key === 'PageUp' ? 5 : -5));
	}

	async function toggle(): Promise<void> {
		if (open) {
			close();
			return;
		}
		open = true;
		await tick();
		sliderEl?.focus();
	}

	function close(): void {
		if (!open) return;
		open = false;
		triggerEl?.focus();
	}

	function handleOutsidePointerDown(event: PointerEvent): void {
		if (!open || !rootEl || !(event.target instanceof Node)) return;
		if (!rootEl.contains(event.target)) close();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !open) return;
		event.preventDefault();
		event.stopPropagation();
		close();
	}

	onDestroy(() => {
		if (frame !== null) cancelAnimationFrame(frame);
		if (announcementTimer !== null) clearTimeout(announcementTimer);
	});
</script>

<svelte:window onpointerdown={handleOutsidePointerDown} />

<div class="connection-aperture" bind:this={rootEl} role="group">
	<button
		class="connection-aperture__trigger"
		type="button"
		bind:this={triggerEl}
		aria-expanded={open}
		aria-controls="connection-aperture-panel"
		onclick={toggle}
		onkeydown={handleKeydown}
	>
		<span>{t('lab.authorConnections.browse.aperture.trigger')}</span>
		<span class="connection-aperture__chevron" aria-hidden="true">▾</span>
	</button>

	{#if open}
		<div
			id="connection-aperture-panel"
			class="connection-aperture__popover"
			role="dialog"
			aria-labelledby="connection-aperture-title"
			tabindex="-1"
			onkeydown={handleKeydown}
		>
			<div class="connection-aperture__heading">
				<h2 id="connection-aperture-title">{t('lab.authorConnections.browse.aperture.title')}</h2>
				<strong>{value}</strong>
			</div>

			<div class="connection-aperture__slider-labels" aria-hidden="true">
				<span>{t('lab.authorConnections.browse.aperture.focused')}</span>
				<span>{t('lab.authorConnections.browse.aperture.wider')}</span>
			</div>
			<input
				class="connection-aperture__slider"
				type="range"
				bind:this={sliderEl}
				min={MIN}
				max={MAX}
				step="1"
				{value}
				aria-label={t('lab.authorConnections.browse.aperture.accessibleName')}
				aria-valuemin={MIN}
				aria-valuemax={MAX}
				aria-valuenow={value}
				aria-valuetext={t('lab.authorConnections.browse.aperture.ariaValue', { count: value })}
				oninput={handleInput}
				onkeydown={handleSliderKeydown}
			/>
			<div
				class="connection-aperture__presets"
				role="group"
				aria-label={t('lab.authorConnections.browse.aperture.shortcuts')}
			>
				{#each PRESETS as preset (preset)}
					<button
						type="button"
						class:connection-aperture__preset--active={value === preset}
						class="connection-aperture__preset"
						onclick={() => commit(preset)}
					>
						{preset}
					</button>
				{/each}
			</div>

			{#if mappedCount !== visibleCount}
				<div class="connection-aperture__status">
					<p>
						{t('lab.authorConnections.browse.aperture.mapped', {
							table: visibleCount,
							mapped: mappedCount
						})}
					</p>
				</div>
			{/if}
		</div>
	{/if}

	<span class="connection-aperture__announcement" aria-live="polite" aria-atomic="true">
		{announcement}
	</span>
</div>

<style>
	.connection-aperture {
		position: relative;
		pointer-events: auto;
		font-family: var(--font-family-interactive);
	}
	.connection-aperture__trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2.5rem;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
		font-size: var(--primitive-type-size-14);
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		box-shadow: var(--shadow-sm, 0 1px 3px rgb(0 0 0 / 12%));
	}
	.connection-aperture__trigger:hover {
		border-color: var(--color-border-hover);
		background: var(--color-bg-hover);
	}
	.connection-aperture__trigger:focus-visible,
	.connection-aperture__preset:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.connection-aperture__chevron {
		font-size: 0.9em;
		line-height: 1;
	}
	.connection-aperture__popover {
		position: absolute;
		z-index: 5;
		bottom: calc(100% + var(--space-3));
		left: 0;
		width: min(23rem, calc(100vw - 2rem));
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md, 0.75rem);
		background: var(--color-bg);
		color: var(--color-text);
		box-shadow: var(--shadow-lg, 0 8px 30px rgb(0 0 0 / 18%));
	}
	.connection-aperture__heading,
	.connection-aperture__slider-labels {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.connection-aperture__heading h2 {
		margin: 0;
		font-size: var(--primitive-type-size-16);
	}
	.connection-aperture__heading strong {
		font-size: var(--primitive-type-size-18);
	}
	.connection-aperture__slider-labels {
		margin-top: var(--space-4);
		font-size: var(--primitive-type-size-13);
		color: var(--color-text-muted);
	}
	.connection-aperture__slider {
		display: block;
		width: 100%;
		margin: var(--space-2) 0 0;
		accent-color: var(--color-accent);
		cursor: pointer;
	}
	.connection-aperture__presets {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.connection-aperture__preset {
		min-width: 2.5rem;
		min-height: 2.25rem;
		padding: 0.25rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-bg-subtle, var(--color-bg-hover));
		color: var(--color-text-muted);
		font: inherit;
		font-size: var(--primitive-type-size-13);
		cursor: pointer;
	}
	.connection-aperture__preset:hover,
	.connection-aperture__preset--active {
		border-color: var(--color-border-hover);
		background: var(--color-bg-hover);
		color: var(--color-text);
		font-weight: 700;
	}
	.connection-aperture__status {
		display: grid;
		gap: 0.2rem;
		margin-top: var(--space-4);
		font-size: var(--primitive-type-size-13);
		line-height: 1.35;
	}
	.connection-aperture__status p {
		margin: 0;
	}
	.connection-aperture__announcement {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 40rem) {
		.connection-aperture__popover {
			position: fixed;
			inset: auto 1rem 1rem;
			width: auto;
		}
	}
</style>
