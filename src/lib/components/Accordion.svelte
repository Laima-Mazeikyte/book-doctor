<script lang="ts">
	import { getOpenBugReportContext } from '$lib/bugReportContext';
	import faqYaml from '$lib/copy/faq.yaml';
	import {
		faqAnswerParagraphs,
		faqParagraphBlock,
		parseFaqParagraph,
		type FaqAnswerFormat
	} from '$lib/copy/faqAnswer';
	import { ChevronDown } from 'lucide-svelte';

	const openBugReport = getOpenBugReportContext();

	type FaqItem = {
		id: string;
		question: string;
		answer: string;
		answerFormat?: FaqAnswerFormat;
	};

	const faqItems = (faqYaml as { en: { items: FaqItem[] } }).en.items;

	let rows = $state(faqItems.map((item) => ({ ...item, open: false })));

	function toggleRow(id: string) {
		const row = rows.find((r) => r.id === id);
		if (row) row.open = !row.open;
	}

	function paragraphsFor(row: (typeof rows)[number]): string[] {
		return faqAnswerParagraphs(row.answer);
	}

</script>

<div class="accordion">
	{#each rows as row (row.id)}
		<div class="accordion__item" class:accordion__item--open={row.open}>
			<button
				type="button"
				id="accordion-{row.id}-trigger"
				class="accordion__summary typ-interactive-1"
				aria-expanded={row.open}
				aria-controls="accordion-{row.id}-panel"
				onclick={() => toggleRow(row.id)}
			>
				<span class="accordion__icon" aria-hidden="true">
					<ChevronDown size={20} strokeWidth={2} class="accordion__chevron" />
				</span>
				<span class="accordion__question">{row.question}</span>
			</button>
			<div
				id="accordion-{row.id}-panel"
				class="accordion__panel"
				class:accordion__panel--open={row.open}
				role="region"
				aria-labelledby="accordion-{row.id}-trigger"
				aria-hidden={!row.open}
			>
				<div class="accordion__panel-inner">
					{#each paragraphsFor(row) as para, i (`${row.id}-${i}`)}
						{@const block = faqParagraphBlock(para)}
						{#if block.kind === 'blockquote'}
							<blockquote class="accordion__answer accordion__answer--quote typ-body">
								{#each parseFaqParagraph(
									block.text,
									row.answerFormat ?? 'markdown'
								) as seg, j (`${row.id}-${i}-${j}`)}
									{#if seg.type === 'text'}
										{seg.text}
									{:else if seg.type === 'bold'}
										<strong>{seg.text}</strong>
									{:else if seg.type === 'link' && seg.internalAction === 'bugReport'}
										{#if openBugReport}
											<button
												type="button"
												class="accordion__inline-link"
												onclick={openBugReport}
											>
												{seg.text}
											</button>
										{:else}
											{seg.text}
										{/if}
									{:else if seg.type === 'link' && seg.external}
										<a
											href={seg.href}
											class="accordion__inline-link"
											target="_blank"
											rel="noopener noreferrer">{seg.text}</a>
									{:else if seg.type === 'link'}
										<a href={seg.href} class="accordion__inline-link">{seg.text}</a>
									{/if}
								{/each}
							</blockquote>
						{:else}
							<p class="accordion__answer typ-body">
								{#each parseFaqParagraph(para, row.answerFormat ?? 'markdown') as seg, j (`${row.id}-${i}-${j}`)}
									{#if seg.type === 'text'}
										{seg.text}
									{:else if seg.type === 'bold'}
										<strong>{seg.text}</strong>
									{:else if seg.type === 'link' && seg.internalAction === 'bugReport'}
										{#if openBugReport}
											<button
												type="button"
												class="accordion__inline-link"
												onclick={openBugReport}
											>
												{seg.text}
											</button>
										{:else}
											{seg.text}
										{/if}
									{:else if seg.type === 'link' && seg.external}
										<a
											href={seg.href}
											class="accordion__inline-link"
											target="_blank"
											rel="noopener noreferrer">{seg.text}</a>
									{:else if seg.type === 'link'}
										<a href={seg.href} class="accordion__inline-link">{seg.text}</a>
									{/if}
								{/each}
							</p>
						{/if}
					{/each}
				</div>
			</div>
		</div>
	{/each}
</div>

<style>
	/* ease-out + ~240ms: user-driven reveal (animations.dev-style) */
	.accordion {
		--accordion-chevron-size: 20px;
		--accordion-ease-out: cubic-bezier(0.165, 0.84, 0.44, 1);
		--accordion-duration: 0.24s;
		--accordion-panel-max-height: min(100dvh, 60rem);
		display: flex;
		flex-direction: column;
		gap: 0;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	.accordion__item {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	.accordion__summary {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: var(--space-4);
		width: 100%;
		min-height: var(--min-tap);
		margin: 0;
		padding: var(--space-2) var(--space-4);
		border: none;
		border-radius: 24px;
		background: transparent;
		cursor: pointer;
		color: var(--color-text);
		text-align: start;
		appearance: none;
		transition: background var(--duration-fast) ease;
	}

	.accordion__summary:hover {
		background: var(--color-interactive-hover-subtle);
	}

	.accordion__summary:focus {
		outline: none;
	}

	.accordion__summary:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}

	.accordion__question {
		flex: 1;
		min-width: 0;
		max-width: min(65ch, 100%);
		color: var(--primitive-accent-brand);
		overflow-wrap: break-word;
		word-break: break-word;
	}

	.accordion__icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
	}

	:global(.accordion__chevron) {
		display: block;
		transition: transform var(--accordion-duration) var(--accordion-ease-out);
	}

	.accordion__item--open :global(.accordion__chevron) {
		transform: rotate(180deg);
	}

	/**
	 * Native <details> toggles content in a way that skips CSS height transitions on children.
	 * Plain div + button: max-height / height transitions run reliably.
	 */
	.accordion__panel {
		overflow: hidden;
		min-width: 0;
		padding: 0 var(--space-4);
		box-sizing: border-box;
		max-height: 0;
		transition: max-height var(--accordion-duration) var(--accordion-ease-out);
	}

	.accordion__panel--open {
		max-height: var(--accordion-panel-max-height);
	}

	@supports (interpolate-size: allow-keywords) {
		.accordion__panel {
			max-height: none;
			height: 0;
			interpolate-size: allow-keywords;
			transition: height var(--accordion-duration) var(--accordion-ease-out);
		}

		.accordion__panel--open {
			max-height: none;
			height: auto;
		}
	}

	.accordion__panel-inner {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-2);
		padding-bottom: var(--space-6);
		/* Align answers with question text (past chevron + gap). */
		padding-left: calc(var(--accordion-chevron-size) + var(--space-4));
	}

	.accordion__answer {
		margin: 0;
		max-width: min(65ch, 100%);
		overflow-wrap: break-word;
		word-break: break-word;
		letter-spacing: 0.3px;
	}

	.accordion__answer--quote {
		margin: 0;
		padding: 0 0 0 var(--space-4);
		border-left: 3px solid var(--color-text-muted);
		font-style: normal;
	}

	/* Light face has no heavier master; map emphasis to the Bold cut. */
	.accordion__answer :global(strong) {
		font-family: var(--primitive-font-family-content-bold);
		font-weight: 700;
	}

	.accordion__panel-inner :is(a, button).accordion__inline-link {
		color: var(--color-text);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.accordion__panel-inner .accordion__inline-link {
		font: inherit;
		letter-spacing: inherit;
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		cursor: pointer;
		text-align: inherit;
	}

	.accordion__panel-inner :is(a, button).accordion__inline-link:hover {
		color: var(--color-text);
		opacity: 0.85;
	}

	@media (prefers-reduced-motion: reduce) {
		.accordion__summary {
			transition: none;
		}

		:global(.accordion__chevron) {
			transition: none;
		}

		.accordion__panel {
			transition: none;
		}
	}
</style>
