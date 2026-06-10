<script lang="ts">
	import { t } from '$lib/copy';
	import type { Book } from '$lib/types/book';
	import {
		DEFAULT_SHORTLIST_META_SECTIONS,
		sectionVisible,
		type ShortlistMetaSection
	} from './shortlist-meta';

	interface Props {
		book: Book;
		sections?: ShortlistMetaSection[];
	}

	let { book, sections = DEFAULT_SHORTLIST_META_SECTIONS }: Props = $props();

	const visibleSections = $derived(sections.filter((s) => sectionVisible(s, book)));
</script>

{#each visibleSections as section (section.kind === 'custom' ? section.id : section.kind)}
	{#if section.kind === 'type' && book.type?.trim()}
		<p class="shortlist-meta__type typ-caption">
			<span class="shortlist-meta__type-label">{t('recommendations.shortlist.typeLabel')}</span>
			{book.type.trim()}
		</p>
	{:else if section.kind === 'year' && book.year?.trim()}
		<p class="shortlist-meta__year typ-caption">{book.year}</p>
	{:else if section.kind === 'genres' && book.genres && book.genres.length > 0}
		<ul class="shortlist-meta__genres" aria-label={t('shared.recommendationCard.genres')}>
			{#each book.genres as genre}
				<li class="shortlist-meta__genre">{genre}</li>
			{/each}
		</ul>
	{/if}
{/each}

<style>
	.shortlist-meta__type {
		margin: 0;
		color: var(--color-text-muted);
	}
	.shortlist-meta__type-label {
		font-weight: var(--typ-caption-font-weight);
	}
	.shortlist-meta__year {
		margin: 0;
		color: var(--color-text-muted);
	}
	.shortlist-meta__genres {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.shortlist-meta__genre {
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--color-interactive-hover-subtle);
		font-size: var(--typ-caption-font-size);
		line-height: var(--typ-caption-line-height);
	}
</style>
