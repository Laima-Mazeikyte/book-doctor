<script lang="ts">
	import { BookOpen } from 'lucide-svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { preloadData } from '$app/navigation';
	import { navigating } from '$app/state';
	import { bookPath } from '$lib/books/bookUrl';
	import { coverUrlForBookIdAtSize } from '$lib/book-cover';
	import type { BookSeries } from '$lib/books/series';
	let {
		series,
		currentBookId,
		imagesReady = false
	}: { series: BookSeries; currentBookId: string; imagesReady?: boolean } = $props();
	let strip = $state<HTMLOListElement>();
	let coversReleased = $state(false);
	let preloadedFor = $state<string | null>(null);
	const failedCovers = new SvelteSet<string>();
	const pendingPath = $derived(navigating.to?.url.pathname ?? null);
	const pendingMember = $derived(
		pendingPath
			? series.members.find((member) => resolve(bookPath(member)) === pendingPath)
			: undefined
	);

	$effect(() => {
		// Once shown, retain these image elements when another volume's cover is loading.
		if (imagesReady) coversReleased = true;
	});

	$effect(() => {
		if (!imagesReady || pendingPath || preloadedFor === currentBookId) return;
		const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
			.connection;
		if (connection?.saveData) return;
		const index = series.members.findIndex((member) => member.book_id === currentBookId);
		const next = index >= 0 ? series.members[index + 1] : undefined;
		if (!next) return;
		// Existing hover/focus intent takes precedence over speculative next-volume data.
		if (strip?.matches(':hover') || strip?.contains(document.activeElement)) return;
		preloadedFor = currentBookId;
		void preloadData(resolve(bookPath(next))).catch(() => undefined);
	});

	function revealCurrentVolume(element: HTMLOListElement) {
		// Center only on entry; preserve the reader's scroll position between volumes.
		const active = element.querySelector<HTMLAnchorElement>('[aria-current="page"]');
		if (!active) return;
		element.scrollLeft +=
			active.getBoundingClientRect().left -
			element.getBoundingClientRect().left -
			(element.clientWidth - active.offsetWidth) / 2;
	}
</script>

<section class="book-series" aria-label="Series information">
	<p class="series-title">{series.title} · Book {series.number}</p>
	{#if series.members.length}
		<ol
			bind:this={strip}
			use:revealCurrentVolume
			class="series-books"
			aria-label={`Books in ${series.title}`}
		>
			{#each series.members as member (member.book_id)}
				<li>
					<a
						href={resolve(bookPath(member))}
						data-sveltekit-noscroll
						class:series-book--selected={pendingMember
							? pendingMember.book_id === member.book_id
							: member.book_id === currentBookId}
						aria-busy={pendingMember?.book_id === member.book_id ? 'true' : undefined}
						aria-label={`${member.title}, Book ${member.number} in ${series.title}`}
						title={`${member.title} · Book ${member.number}`}
						aria-current={member.book_id === currentBookId ? 'page' : undefined}
					>
						<span class="cover-name">{member.title}, Book {member.number} in {series.title}</span>
						<span class="series-cover">
							{#if coversReleased && !failedCovers.has(member.book_id) && coverUrlForBookIdAtSize(member.book_id, 200)}
								<img
									src={coverUrlForBookIdAtSize(member.book_id, 200)}
									alt={`${member.title}, Book ${member.number} in ${series.title}`}
									width="200"
									height="300"
									loading="lazy"
									fetchpriority="low"
									decoding="async"
									onerror={() => failedCovers.add(member.book_id)}
								/>
							{:else if failedCovers.has(member.book_id) || !coverUrlForBookIdAtSize(member.book_id, 200)}
								<span class="cover-fallback" aria-hidden="true">
									<BookOpen size={18} />
									<span>{member.title}</span>
								</span>
							{/if}
							<noscript>
								<img
									src={coverUrlForBookIdAtSize(member.book_id, 200)}
									alt={`${member.title}, Book ${member.number} in ${series.title}`}
									width="200"
									height="300"
									loading="lazy"
									fetchpriority="low"
									decoding="async"
								/>
							</noscript>
						</span>
					</a>
				</li>
			{/each}
		</ol>
	{/if}
	<span class="cover-name" role="status"
		>{pendingMember ? `Opening ${pendingMember.title}…` : ''}</span
	>
</section>

<style>
	.book-series {
		position: relative;
		margin: 1rem 0;
	}
	.series-title {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.series-books {
		display: flex;
		gap: var(--space-2);
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: thin;
		list-style: none;
		padding: 6px;
		margin: var(--space-2) 0 0;
	}
	li {
		flex: 0 0 4rem;
		min-width: 0;
	}
	a {
		position: relative;
		display: block;
		color: inherit;
		text-decoration: none;
		border-radius: var(--radius-sm);
		transition:
			transform var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default);
	}
	a:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-card-hover);
	}
	a:hover .series-cover {
		border-color: var(--color-border-hover);
	}
	a:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 3px;
		transform: none;
	}
	.series-cover {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		aspect-ratio: 2 / 3;
		overflow: hidden;
		border-radius: var(--radius-sm);
		background: var(--color-card-placeholder-bg);
		border: 1px solid var(--color-border);
		box-sizing: border-box;
	}
	a.series-book--selected .series-cover {
		border-color: var(--color-text);
		box-shadow: 0 0 0 1px var(--color-text);
	}
	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.cover-name {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.cover-fallback {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1);
		color: var(--color-text-muted);
		font: 0.625rem/1.3 var(--font-family-interactive);
		text-align: center;
	}
	.cover-fallback span {
		max-height: 3.9em;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	@media (max-width: 600px) {
		li {
			flex-basis: 3.5rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		a {
			transition: none;
		}
		a:hover {
			transform: none;
		}
	}
</style>
