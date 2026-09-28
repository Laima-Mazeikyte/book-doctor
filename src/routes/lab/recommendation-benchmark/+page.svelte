<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { t } from '$lib/copy';
	import Spinner from '$lib/components/Spinner.svelte';
	import BenchmarkAccuracy from '$lib/components/lab/BenchmarkAccuracy.svelte';
	import BenchmarkReader from '$lib/components/lab/BenchmarkReader.svelte';
	import { getFooterSupplementContext } from '$lib/footerSupplementContext';
	import {
		createHistoryLoader,
		loadRelease,
		type Release
	} from '$lib/lab/recommendation-benchmark/release';
	import {
		BenchmarkFormatError,
		type ReaderHistory
	} from '$lib/lab/recommendation-benchmark/types';

	const COPY = 'lab.recommendationBenchmark.';

	let release = $state.raw<Release | null>(null);
	let loadError = $state<string | null>(null);
	let methodologyOpen = $state(false);
	/** The ChatGPT prompt, opened from the word "prompt" in How it works. */
	let promptOpen = $state(false);

	/** One history cache per loaded release. */
	const loadHistory = $derived<((id: string) => Promise<ReaderHistory>) | null>(
		release ? createHistoryLoader(release) : null
	);
	const chatgptPrompt = $derived(
		release?.manifest.systems.find((system) => system.id === 'chatgpt')?.prompt
	);

	function describeError(error: unknown): string {
		if (error instanceof BenchmarkFormatError) return t(COPY + 'errors.format');
		return t(COPY + 'errors.load');
	}

	async function start(): Promise<void> {
		loadError = null;
		try {
			const loaded = await loadRelease();
			release = loaded;
		} catch (error) {
			loadError = describeError(error);
		}
	}

	/** Native modal dialog: outside clicks and Escape close it; focus returns to the opener. */
	function openDialog(node: HTMLDialogElement, onClose: () => void) {
		const trigger = document.activeElement;
		node.showModal();
		let startedOutside = false;
		const outside = (event: MouseEvent) => {
			const rect = node.getBoundingClientRect();
			return (
				event.clientX < rect.left ||
				event.clientX > rect.right ||
				event.clientY < rect.top ||
				event.clientY > rect.bottom
			);
		};
		const pointerDown = (event: PointerEvent) => {
			startedOutside = outside(event);
		};
		const click = (event: MouseEvent) => {
			if (startedOutside && outside(event)) {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			}
		};
		const close = () => onClose();
		node.addEventListener('pointerdown', pointerDown);
		node.addEventListener('click', click);
		node.addEventListener('close', close);
		return {
			destroy() {
				node.removeEventListener('pointerdown', pointerDown);
				node.removeEventListener('click', click);
				node.removeEventListener('close', close);
				node.close();
				if (trigger instanceof HTMLElement && trigger.isConnected) {
					trigger.focus({ preventScroll: true });
				}
			}
		};
	}

	const footerSupplement = getFooterSupplementContext();
	const footerSupplementOwner = Symbol('recommendation-benchmark');
	$effect(() => {
		if (release)
			footerSupplement?.set(
				footerSupplementOwner,
				t(COPY + 'footer', { version: release.manifest.version })
			);
		else footerSupplement?.clear(footerSupplementOwner);
	});

	onMount(() => {
		void start();
	});
	onDestroy(() => {
		footerSupplement?.clear(footerSupplementOwner);
	});
</script>

<svelte:head>
	<title>{t(COPY + 'title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t(COPY + 'metaDescription')} />
</svelte:head>

<div class="benchmark-page">
	<header class="benchmark-page__header">
		<h1 class="benchmark-page__title typ-display2 typ-display2--content">{t(COPY + 'title')}</h1>
		<button
			type="button"
			class="benchmark-button benchmark-button--secondary"
			aria-haspopup="dialog"
			disabled={!release}
			onclick={() => (methodologyOpen = true)}>{t(COPY + 'methodology.open')}</button
		>
	</header>
	<p class="benchmark-page__lead">{t(COPY + 'lead')}</p>

	{#if loadError}
		<div class="benchmark-state benchmark-state--error" role="alert">
			<div>
				<strong>{t(COPY + 'errors.pageHeading')}</strong>
				<p>{loadError}</p>
			</div>
			<button
				type="button"
				class="benchmark-button benchmark-button--secondary"
				onclick={() => void start()}>{t(COPY + 'errors.retry')}</button
			>
		</div>
	{:else if !release || !loadHistory}
		<div class="benchmark-state" aria-live="polite">
			<Spinner />
			<p>{t(COPY + 'loading')}</p>
		</div>
	{:else}
		<div class="benchmark-page__sections">
			<div class="benchmark-section" id="benchmark-section-accuracy">
				<BenchmarkAccuracy
					summary={release.summary}
					populations={release.manifest.populations}
					historyBoundaries={release.manifest.cohort.history_boundaries}
				/>
			</div>
			<section
				class="benchmark-section benchmark-block"
				id="benchmark-section-readers"
				aria-labelledby="benchmark-readers-heading"
			>
				<h2 class="benchmark-block__heading" id="benchmark-readers-heading">
					{t(COPY + 'readers.heading')}
				</h2>
				<p class="benchmark-note">{t(COPY + 'readers.intro')}</p>
				<BenchmarkReader readers={release.readers} {loadHistory} />
			</section>
		</div>

		{#if methodologyOpen}
			<dialog
				use:openDialog={() => (methodologyOpen = false)}
				class="benchmark-methodology"
				aria-labelledby="benchmark-methodology-heading"
			>
				<button
					type="button"
					class="benchmark-close"
					aria-label={t(COPY + 'methodology.close')}
					onclick={() => (methodologyOpen = false)}>&times;</button
				>
				<h2 id="benchmark-methodology-heading">{t(COPY + 'methodology.heading')}</h2>
				<p>{t(COPY + 'methodology.intro')}</p>
				<h3>{t(COPY + 'methodology.readersHeading')}</h3>
				<p>{t(COPY + 'methodology.readers')}</p>
				<h3>{t(COPY + 'methodology.contendersHeading')}</h3>
				<ul class="benchmark-methodology__systems">
					<li><strong>{t(COPY + 'systems.ours')}:</strong> {t(COPY + 'methodology.ours')}</li>
					<li>
						<strong>{t(COPY + 'systems.hardcover')}:</strong>
						{t(COPY + 'methodology.hardcover')}
					</li>
					<li>
						<strong>{t(COPY + 'methodology.chatgptName')}:</strong>
						{t(COPY + 'methodology.chatgptBefore')}
						<button
							type="button"
							class="benchmark-methodology__link"
							aria-expanded={promptOpen}
							aria-controls="benchmark-chatgpt-prompt"
							onclick={() => (promptOpen = !promptOpen)}
							>{t(COPY + 'methodology.chatgptPrompt')}</button
						>{t(COPY + 'methodology.chatgptAfter')}
						{#if promptOpen}
							<pre id="benchmark-chatgpt-prompt">{chatgptPrompt}</pre>
						{/if}
					</li>
				</ul>
				<h3>{t(COPY + 'methodology.scoringHeading')}</h3>
				<p>{t(COPY + 'methodology.scoring')}</p>
				<h3>{t(COPY + 'methodology.certaintyHeading')}</h3>
				<p>{t(COPY + 'methodology.certainty')}</p>
				<h3>{t(COPY + 'methodology.limitsHeading')}</h3>
				<p>{t(COPY + 'methodology.limits')}</p>
			</dialog>
		{/if}
	{/if}
</div>

<style>
	.benchmark-page {
		/* Fixed series identity for the whole page: ours, Hardcover, ChatGPT. */
		--benchmark-ours: var(--color-viz-series-1);
		--benchmark-hardcover: var(--color-viz-series-3);
		--benchmark-chatgpt: var(--color-viz-series-2);
		display: flex;
		flex-direction: column;
		gap: clamp(var(--space-4), 2.5vw, var(--space-6));
		width: 100%;
		max-width: 72rem;
		min-width: 0;
		margin-inline: auto;
		padding-bottom: var(--space-12);
	}
	.benchmark-page__header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.benchmark-page__title {
		margin: 0 !important;
		color: var(--color-text);
		font-size: clamp(2rem, 5vw, 3rem);
		letter-spacing: -0.03em;
		line-height: 1;
	}
	.benchmark-page__lead {
		max-width: 46rem;
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: 0.9375rem;
		line-height: 1.6;
		color: var(--color-text-muted);
	}
	.benchmark-page__sections {
		display: flex;
		flex-direction: column;
		gap: clamp(var(--space-8), 6vw, var(--space-12));
		min-width: 0;
	}
	.benchmark-section {
		display: flex;
		flex-direction: column;
		gap: clamp(var(--space-6), 4vw, var(--space-8));
		min-width: 0;
	}

	/* Shared by the page and its two view components. */
	.benchmark-page :global(.benchmark-block) {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.benchmark-page :global(.benchmark-block__heading) {
		margin: 0;
		font-family: var(--font-family-content);
		font-size: clamp(1.25rem, 2.4vw, 1.5rem);
		font-weight: 400;
		letter-spacing: -0.01em;
		line-height: 1.2;
		color: var(--color-text);
	}
	.benchmark-page :global(.benchmark-note) {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		line-height: 1.55;
		color: var(--color-text-muted);
	}
	.benchmark-page :global(.benchmark-system-name) {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
	}
	/*
	 * One marker shape per recommender everywhere on the page, the same as the history chart's
	 * points: Unread a circle, Hardcover a square, ChatGPT a diamond. Shape as well as color, so
	 * the three stay apart without color vision.
	 */
	.benchmark-page :global(.benchmark-key) {
		display: inline-block;
		flex-shrink: 0;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		background: var(--system-color);
	}
	.benchmark-page :global(.benchmark-key--hardcover) {
		border-radius: 1px;
	}
	.benchmark-page :global(.benchmark-key--chatgpt) {
		border-radius: 1px;
		transform: rotate(45deg) scale(0.85);
	}
	.benchmark-page :global(.benchmark-chip) {
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-family: var(--font-family-interactive);
		font-size: 0.6875rem;
		font-weight: 600;
		white-space: nowrap;
		color: var(--color-text-muted);
	}
	.benchmark-page :global(.benchmark-chip--strong) {
		border-color: color-mix(in srgb, var(--chip-color, var(--color-accent-brand)) 60%, transparent);
		color: var(--color-text);
		background: color-mix(in srgb, var(--chip-color, var(--color-accent-brand)) 16%, transparent);
	}
	.benchmark-page :global(.benchmark-button) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.5rem;
		padding: 0.625rem 0.875rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		font-weight: 600;
		line-height: 1.2;
		color: var(--color-button-primary-text, var(--color-bg));
		background: var(--color-button-primary-bg);
		cursor: pointer;
		transition:
			background var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.benchmark-page :global(.benchmark-button--secondary) {
		border-color: var(--color-border);
		color: var(--color-text);
		background: var(--color-bg-muted);
	}
	.benchmark-page :global(.benchmark-button--secondary:hover) {
		border-color: var(--color-border-hover);
		background: var(--color-interactive-hover-subtle);
	}
	.benchmark-page :global(.benchmark-button:disabled) {
		opacity: 0.5;
		cursor: default;
	}
	.benchmark-page :global(button:focus-visible) {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.benchmark-page :global(.benchmark-sr-only) {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.benchmark-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-12) var(--space-4);
		font-family: var(--font-family-interactive);
		font-size: 0.875rem;
		text-align: center;
		color: var(--color-text-muted);
	}
	.benchmark-state p {
		margin: 0;
	}
	.benchmark-state--error {
		flex-direction: row;
		align-items: flex-start;
		justify-content: space-between;
		padding: var(--space-4);
		border: 1px solid var(--color-error-border);
		border-radius: var(--radius-sm);
		text-align: left;
		color: var(--color-error-text);
		background: var(--color-error-bg);
	}
	.benchmark-state--error strong {
		display: block;
		margin-bottom: var(--space-1);
	}

	.benchmark-methodology {
		position: fixed;
		inset: 0;
		width: min(42rem, calc(100vw - 2rem));
		max-height: 80dvh;
		margin: auto;
		overflow: auto;
		padding: var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text);
		background: var(--color-card-bg);
	}
	.benchmark-methodology:not([open]) {
		display: none;
	}
	.benchmark-methodology::backdrop {
		background: var(--color-overlay-scrim);
	}
	.benchmark-methodology h2 {
		margin: var(--space-2) 0 var(--space-3);
		padding-right: 2rem;
		font-family: var(--font-family-content);
		font-size: clamp(1.5rem, 3vw, 2rem);
		font-weight: 400;
		letter-spacing: -0.02em;
		line-height: 1.1;
	}
	.benchmark-methodology h3 {
		margin: var(--space-4) 0 var(--space-2);
		font-family: var(--font-family-interactive);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.benchmark-methodology p,
	.benchmark-methodology__systems {
		margin: 0 0 var(--space-3);
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		line-height: 1.6;
		color: var(--color-text-muted);
	}
	.benchmark-methodology__systems {
		padding-left: 1.1rem;
	}
	.benchmark-methodology__systems li + li {
		margin-top: var(--space-2);
	}
	.benchmark-methodology__systems strong {
		font-weight: 600;
		color: var(--color-text);
	}
	/* The word "prompt" opens the ChatGPT prompt in place. */
	.benchmark-methodology__link {
		display: inline;
		margin: 0;
		padding: 0;
		border: 0;
		font: inherit;
		color: var(--color-text);
		text-decoration: underline;
		text-underline-offset: 2px;
		background: none;
		cursor: pointer;
	}
	.benchmark-methodology pre {
		max-height: 16rem;
		overflow: auto;
		margin: var(--space-2) 0 0;
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		line-height: 1.5;
		white-space: pre-wrap;
		background: var(--color-bg-muted);
	}
	.benchmark-close {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		font-size: 1.5rem;
		color: var(--color-text-muted);
		background: transparent;
		cursor: pointer;
	}
	.benchmark-close:hover {
		color: var(--color-text);
		background: var(--color-interactive-hover-subtle);
	}
	:global(html:has(.benchmark-page dialog[open])) {
		overflow: hidden;
	}

	@media (max-width: 767px) {
		.benchmark-page {
			padding-bottom: var(--space-8);
		}
	}
</style>
