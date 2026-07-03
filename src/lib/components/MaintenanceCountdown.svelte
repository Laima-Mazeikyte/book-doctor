<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/copy';

	let { until }: { until: string } = $props();

	const target = $derived(Date.parse(until));
	const isValid = $derived(!Number.isNaN(target));

	let now = $state(Date.now());

	onMount(() => {
		const id = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(id);
	});

	const remainingMs = $derived(isValid ? Math.max(0, target - now) : 0);
	const expired = $derived(isValid && remainingMs === 0);

	// Once the ETA passes, poll by reloading so the page flips back automatically when we return.
	$effect(() => {
		if (!expired) return;
		const id = setTimeout(() => location.reload(), 20000);
		return () => clearTimeout(id);
	});

	function pad(n: number): string {
		return String(n).padStart(2, '0');
	}

	const parts = $derived.by(() => {
		const totalSec = Math.floor(remainingMs / 1000);
		return {
			hours: pad(Math.floor(totalSec / 3600)),
			minutes: pad(Math.floor((totalSec % 3600) / 60)),
			seconds: pad(totalSec % 60)
		};
	});
</script>

{#if !isValid}
	<p class="maintenance-countdown__note typ-body">{t('maintenance.noEta')}</p>
{:else if expired}
	<p class="maintenance-countdown__note typ-body" role="status">{t('maintenance.backSoon')}</p>
{:else}
	<p class="maintenance-countdown__label">{t('maintenance.backOnlineLabel')}</p>
	<div
		class="maintenance-countdown"
		role="timer"
		aria-label={`${parts.hours} ${t('maintenance.hoursLabel')}, ${parts.minutes} ${t('maintenance.minutesLabel')}, ${parts.seconds} ${t('maintenance.secondsLabel')}`}
	>
		<div class="maintenance-countdown__unit">
			<span class="maintenance-countdown__value">{parts.hours}</span>
			<span class="maintenance-countdown__unit-label">{t('maintenance.hoursLabel')}</span>
		</div>
		<span class="maintenance-countdown__sep" aria-hidden="true">:</span>
		<div class="maintenance-countdown__unit">
			<span class="maintenance-countdown__value">{parts.minutes}</span>
			<span class="maintenance-countdown__unit-label">{t('maintenance.minutesLabel')}</span>
		</div>
		<span class="maintenance-countdown__sep" aria-hidden="true">:</span>
		<div class="maintenance-countdown__unit">
			<span class="maintenance-countdown__value">{parts.seconds}</span>
			<span class="maintenance-countdown__unit-label">{t('maintenance.secondsLabel')}</span>
		</div>
	</div>
{/if}

<style>
	.maintenance-countdown__label {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.6;
		margin: 0 0 var(--space-2);
	}
	.maintenance-countdown {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		gap: var(--space-2);
	}
	.maintenance-countdown__unit {
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 3ch;
	}
	.maintenance-countdown__value {
		font-variant-numeric: tabular-nums;
		font-size: 2.5rem;
		font-weight: 600;
		line-height: 1;
	}
	.maintenance-countdown__unit-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.6;
		margin-top: var(--space-1);
	}
	.maintenance-countdown__sep {
		font-size: 2.5rem;
		font-weight: 600;
		line-height: 1;
		opacity: 0.4;
	}
	.maintenance-countdown__note {
		margin: 0;
	}
</style>
