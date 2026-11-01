<script lang="ts">
	import { normalizeAwards } from '$lib/books/annotations';
	let { awards }: { awards: unknown } = $props();
	const id = $props.id();
	let expandedAwards = $state.raw<unknown>(null);
	const entries = $derived(normalizeAwards(awards));
	const expanded = $derived(expandedAwards === awards);
	const visibleEntries = $derived(expanded ? entries : entries.slice(0, 6));
</script>

{#if entries.length}
	<section class="book-awards" aria-labelledby="{id}-heading">
		<h2 id="{id}-heading">Awards</h2>
		<ul id="{id}-list">
			{#each visibleEntries as award, index (index)}
				<li>
					<span class="award-name">{award.name}</span>
					<span class="award-detail"
						><span class:winner={award.status === 'winner'}
							>{award.status === 'winner' ? 'Winner' : 'Nominee'}</span
						>{#if award.year !== null}<span> · {award.year}</span>{/if}</span
					>
				</li>
			{/each}
		</ul>
		{#if entries.length > 6}
			<button
				type="button"
				aria-expanded={expanded}
				aria-controls="{id}-list"
				onclick={() => (expandedAwards = expanded ? null : awards)}
			>
				{expanded ? 'Show fewer awards' : `Show all ${entries.length} awards`}
			</button>
		{/if}
	</section>
{/if}

<style>
	.book-awards {
		margin-top: 1.75rem;
	}
	h2 {
		margin: 0 0 0.85rem;
		font: 600 0.85rem/1.3 var(--font-family-interactive);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	ul {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
		gap: 0.9rem 1.4rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		min-width: 0;
		padding-left: 0.7rem;
		border-left: 2px solid var(--color-border);
	}
	.award-name {
		display: block;
		overflow-wrap: anywhere;
		font-weight: 500;
		line-height: 1.4;
	}
	.award-detail {
		display: block;
		margin-top: 0.2rem;
		color: var(--color-text-muted);
		font: 0.8rem/1.5 var(--font-family-interactive);
	}
	.winner {
		color: var(--color-text);
		font-weight: 600;
	}
	button {
		display: block;
		margin-top: 1rem;
		padding: 0.5rem 0;
		border: 0;
		background: none;
		color: var(--color-text);
		font: 500 0.85rem/1.5 var(--font-family-interactive);
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}
</style>
