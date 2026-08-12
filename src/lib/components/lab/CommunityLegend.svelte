<script lang="ts">
	import { t } from '$lib/copy';
	import type { Community, Subcommunity } from '$lib/lab/author-taste/types';

	interface Props {
		communities: Community[];
		subcommunitiesByCommunity: Map<number, Subcommunity[]>;
		selectedCommunityId?: number | null;
		selectedSubcommunityId?: number | null;
		onSelectCommunity: (community: Community | null) => void;
		onSelectSubcommunity: (subcommunity: Subcommunity | null) => void;
		/**
		 * Jump to one of a subgroup's representative authors. The profiles cite them by name,
		 * so resolving the name to an author is the page's job -- the legend has no index.
		 */
		onSelectAuthorNamed?: (name: string) => void;
	}

	let {
		communities,
		subcommunitiesByCommunity,
		selectedCommunityId = null,
		selectedSubcommunityId = null,
		onSelectCommunity,
		onSelectSubcommunity,
		onSelectAuthorNamed
	}: Props = $props();

	/*
	 * The communities are the best entry point the release offers. Each arrives with a curated
	 * label, its component genres and its own representative authors -- a far more useful way in
	 * than a list of the most-rated names.
	 *
	 * Expanding one reveals its nested groups. Those are only identified by the
	 * (community, subcommunity) pair, so they are never listed flat: a bare "Group 1" appears
	 * in most communities and would be meaningless on its own.
	 */
	const ordered = $derived([...communities].sort((a, b) => b.size - a.size));
</script>

<div class="community-legend">
	<div class="community-legend__head">
		<h3 class="community-legend__heading typ-h3">
			{t('lab.authorConnections.communities.heading')}
		</h3>
		{#if selectedCommunityId !== null}
			<button
				type="button"
				class="btn btn--tertiary btn--compact"
				onclick={() => onSelectCommunity(null)}
			>
				{t('lab.authorConnections.communities.showAll')}
			</button>
		{/if}
	</div>
	<ul class="community-legend__list">
		{#each ordered as community (community.id)}
			{@const isSelected = community.id === selectedCommunityId}
			{@const communityChildren = isSelected
				? (subcommunitiesByCommunity.get(community.id) ?? [])
				: []}
			<li>
				<button
					type="button"
					class="community-legend__item"
					class:community-legend__item--active={isSelected}
					aria-pressed={isSelected}
					onclick={() => onSelectCommunity(isSelected ? null : community)}
				>
					<span
						class="community-legend__swatch"
						style="background:{community.color}"
						aria-hidden="true"
					></span>
					<span class="community-legend__body">
						<span class="community-legend__label">{community.label}</span>
						<span class="community-legend__meta">
							{t('lab.authorConnections.communities.size', {
								count: community.size.toLocaleString()
							})}
						</span>
						<span class="community-legend__names">
							{community.representativeAuthors.slice(0, 3).join(' \u00b7 ')}
						</span>
					</span>
				</button>

				{#if isSelected && communityChildren.length > 0}
					<div class="community-legend__children">
						<h4 class="community-legend__children-heading">
							{t('lab.authorConnections.communities.within', { community: community.label })}
						</h4>
						<ul class="community-legend__chips">
							{#each communityChildren as child (child.id)}
								<li>
									<button
										type="button"
										class="community-legend__chip"
										class:community-legend__chip--active={child.id === selectedSubcommunityId}
										aria-pressed={child.id === selectedSubcommunityId}
										onclick={() =>
											onSelectSubcommunity(child.id === selectedSubcommunityId ? null : child)}
									>
										<span class="community-legend__chip-label">{child.label}</span>
										<span class="community-legend__chip-meta">
											{t('lab.authorConnections.communities.size', {
												count: child.size.toLocaleString()
											})}
										</span>
									</button>
								</li>
							{/each}
						</ul>
						{#if selectedSubcommunityId !== null}
							{@const child = communityChildren.find((c) => c.id === selectedSubcommunityId)}
							{#if child}
								<!-- Named examples are the most concrete thing here, so make them a way in. -->
								<ul class="community-legend__names-list">
									{#each child.representativeAuthors.slice(0, 5) as name (name)}
										<li>
											<button
												type="button"
												class="community-legend__name"
												onclick={() => onSelectAuthorNamed?.(name)}
											>
												{name}
											</button>
										</li>
									{/each}
								</ul>
								<p class="community-legend__child-genres">
									{child.genreComposition
										.slice(0, 3)
										.map((share) => `${share.genre} ${Math.round(share.fraction * 100)}%`)
										.join(' \u00b7 ')}
								</p>
							{/if}
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
</div>

<style>
	.community-legend {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	.community-legend__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.community-legend__heading {
		margin: 0;
		color: var(--color-text);
	}
	.community-legend__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr;
	}
	.community-legend__list > li {
		min-width: 0;
	}
	.community-legend__item {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-3);
		text-align: left;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--color-border);
		border-radius: 0;
		color: var(--color-text);
		cursor: pointer;
		font-family: var(--font-family-interactive);
		transition: background-color 0.15s ease;
	}
	.community-legend__item:hover {
		border-color: var(--color-border-hover);
		background: var(--color-bg-hover);
	}
	.community-legend__item:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.community-legend__item--active {
		background: var(--color-accent-bg);
	}
	.community-legend__swatch {
		flex: none;
		width: 0.75rem;
		height: 0.75rem;
		margin-top: 0.25rem;
		border-radius: 50%;
	}
	.community-legend__body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.community-legend__label {
		font-size: var(--primitive-type-size-14);
	}
	.community-legend__meta,
	.community-legend__names {
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
	}
	.community-legend__names {
		overflow-wrap: anywhere;
	}

	.community-legend__children {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-3) var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	.community-legend__children-heading {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
	}
	.community-legend__chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.community-legend__chip {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: var(--space-2) var(--space-3);
		text-align: left;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		color: var(--color-text);
		cursor: pointer;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
	}
	.community-legend__chip:hover {
		border-color: var(--color-border-hover);
		background: var(--color-bg-hover);
	}
	.community-legend__chip:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.community-legend__chip--active {
		border-color: var(--color-accent);
		background: var(--color-accent-bg);
	}
	.community-legend__chip-meta {
		color: var(--color-text-muted);
	}
	.community-legend__names-list {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		padding: 0;
	}
	.community-legend__name {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-accent);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		text-align: left;
		text-decoration: underline;
		cursor: pointer;
	}
	.community-legend__name:hover {
		text-decoration: none;
	}
	.community-legend__name:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.community-legend__child-genres {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	@media (min-width: 48rem) and (max-width: 69.99rem) {
		.community-legend__list {
			gap: var(--space-2);
			grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
		}
		.community-legend__item {
			background: var(--color-card-bg);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-sm);
		}
		.community-legend__item--active {
			border-color: var(--color-accent);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.community-legend__item {
			transition: none;
		}
	}
</style>
