<script lang="ts">
	import ModalDialog from '$lib/components/ModalDialog.svelte';
	import Button from '$lib/components/Button.svelte';
	import { X } from 'lucide-svelte';
	import {
		TAG_OPERATORS,
		type TagDraft,
		type TagOperator
	} from '$lib/recommendations/filteredRecommendations';

	let {
		id,
		label,
		options,
		featured,
		sourceTags = [],
		hasSource = false,
		open,
		onOpen,
		onClose,
		value,
		onChange
	}: {
		id: string;
		label: string;
		options: string[];
		featured: string[];
		sourceTags?: string[];
		hasSource?: boolean;
		open: boolean;
		onOpen: () => void;
		onClose: () => void;
		value: TagDraft;
		onChange: (next: TagDraft) => void;
	} = $props();
	let query = $state('');
	let operator = $state<TagOperator>('all_of');
	const names: Record<TagOperator, string> = {
		all_of: 'Require all',
		any_of: 'At least one',
		none_of: 'Exclude'
	};
	const allOptions = $derived(
		[...new Set([...options, ...sourceTags, ...TAG_OPERATORS.flatMap((op) => value[op])])].sort(
			(a, b) => a.localeCompare(b)
		)
	);
	const visibleOptions = $derived(
		allOptions.filter((tag) => tag.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
	);
	const quickOptions = $derived(
		(hasSource && sourceTags.length ? sourceTags : featured).filter(
			(tag) => allOptions.includes(tag) && !TAG_OPERATORS.some((op) => value[op].includes(tag))
		)
	);

	function toggle(tag: string, op: TagOperator) {
		const selected = value[op].includes(tag);
		const next = {
			...value,
			[op]: selected ? value[op].filter((label) => label !== tag) : [...value[op], tag]
		};
		// An explicit new choice replaces an opposite choice for that label.
		// Existing saved contradictions remain intact until the reader edits them.
		if (!selected) {
			for (const other of TAG_OPERATORS) {
				if (other !== op && (op === 'none_of' || other === 'none_of'))
					next[other] = next[other].filter((label) => label !== tag);
			}
		}
		onChange(next);
	}

	function openDialog() {
		query = '';
		onOpen();
	}
</script>

<section class="tag-picker" aria-labelledby={`${id}-heading`}>
	<div class="heading">
		<h3 class="recommendation-filter-label" id={`${id}-heading`}>{label}</h3>
		<button type="button" class="browse" onclick={openDialog}>Browse all</button>
	</div>
	{#if quickOptions.length}
		<div class="chips" aria-label={`Suggested ${label.toLowerCase()} changes`}>
			{#each quickOptions as tag (tag)}
				{@const action = hasSource && sourceTags.includes(tag) ? 'none_of' : 'all_of'}
				<button
					class="recommendation-filter-choice"
					type="button"
					onclick={() => toggle(tag, action)}
					>{action === 'none_of' ? 'Exclude' : 'Require'} {tag}</button
				>
			{/each}
		</div>
	{/if}
	{#each TAG_OPERATORS as op (op)}
		{#if value[op].length}
			<div class="selection" role="group" aria-label={`${label}: ${names[op]}`}>
				<span>{names[op]}</span>
				<div class="chips">
					{#each value[op] as tag (tag)}
						<button
							class="recommendation-filter-choice active"
							type="button"
							aria-label={`Remove ${tag} from ${names[op].toLowerCase()} ${label.toLowerCase()}`}
							onclick={() => toggle(tag, op)}>{tag} <span aria-hidden="true">×</span></button
						>
					{/each}
				</div>
			</div>
		{/if}
	{/each}
</section>

<ModalDialog {open} {onClose} labelledby={`${id}-dialog-heading`} initialFocus={`#${id}-search`}>
	<div class="tag-dialog">
		<div class="heading">
			<h2 id={`${id}-dialog-heading`} class="typ-h3">Choose {label.toLowerCase()}</h2>
			<button
				type="button"
				class="recommendation-filter-close"
				aria-label="Close tag choices"
				onclick={onClose}><X size={18} aria-hidden="true" /></button
			>
		</div>
		<div class="dialog-body scrollbar-subtle">
			<div class="operators" role="group" aria-label={`${label} matching rule`}>
				{#each TAG_OPERATORS as op (op)}
					<button
						class="recommendation-filter-choice"
						type="button"
						class:active={operator === op}
						aria-pressed={operator === op}
						onclick={() => (operator = op)}>{names[op]}</button
					>
				{/each}
			</div>
			<label class="search recommendation-filter-label" for={`${id}-search`}
				>Search {label.toLowerCase()}
				<input
					class="recommendation-filter-input"
					id={`${id}-search`}
					type="search"
					autocomplete="off"
					bind:value={query}
					onkeydown={(event) => {
						if (event.key === 'Enter') event.preventDefault();
					}}
				/>
			</label>
			<p class="hint">
				{operator === 'all_of'
					? 'Books must carry every selected tag.'
					: operator === 'any_of'
						? 'Books must carry at least one selected tag.'
						: 'Books carrying any selected tag are excluded.'}
			</p>
			<div
				class="choices scrollbar-subtle"
				role="group"
				aria-label={`All ${label.toLowerCase()}: ${names[operator]}`}
			>
				{#each visibleOptions as tag (tag)}
					<label
						><input
							type="checkbox"
							checked={value[operator].includes(tag)}
							onchange={() => toggle(tag, operator)}
						/>{tag}</label
					>
				{:else}<p>No matching labels.</p>{/each}
			</div>
			<p class="hint">Matches exact recorded tags.</p>
		</div>
		<div class="heading">
			<Button variant="tertiary" compact onclick={() => onChange({ ...value, [operator]: [] })}
				>Clear this group</Button
			>
			<Button compact onclick={onClose}>Done</Button>
		</div>
	</div>
</ModalDialog>

<style>
	.tag-picker {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
	}
	.heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	h3,
	h2,
	p {
		margin: 0;
	}
	h3 {
		font-family: var(--font-family-interactive);
		font-size: var(--typ-interactive-2-font-size);
	}
	.browse {
		border: 0;
		background: none;
		color: var(--color-text);
		cursor: pointer;
	}
	.browse {
		text-decoration: underline;
		padding: var(--space-2);
		min-height: var(--min-tap);
	}

	.chips,
	.operators {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.selection {
		display: grid;
		gap: var(--space-1);
	}
	.selection > span,
	.hint {
		color: var(--color-text-muted);
		font-size: var(--typ-caption-font-size);
	}
	.tag-dialog {
		min-width: 0;
		width: min(34rem, calc(100vw - 2rem));
		max-height: min(42rem, calc(100dvh - 2rem));
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card-bg);
		color: var(--color-text);
		padding: var(--space-4);
		box-shadow: var(--shadow-modal-elevated);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-height: 0;
		overflow: hidden;
	}
	.tag-dialog > .heading {
		flex-shrink: 0;
	}
	.tag-dialog > .heading:first-child {
		flex-wrap: nowrap;
		align-items: flex-start;
	}
	.tag-dialog h2 {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.dialog-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-height: 0;
		overflow-y: auto;
	}
	.dialog-body > :not(.choices) {
		flex-shrink: 0;
	}
	.search {
		min-width: 0;
		display: grid;
		gap: var(--space-1);
	}

	.choices {
		min-height: 4rem;
		flex: 1;
		overflow-y: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}
	.choices label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		border-bottom: 1px solid var(--color-border);
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
	}
	.choices p {
		padding: var(--space-3);
	}
	button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
