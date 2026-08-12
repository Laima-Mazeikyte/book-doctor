<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { t } from '$lib/copy';
	import { getFooterSupplementContext } from '$lib/footerSupplementContext';
	import { isAnonymousOrSignedOut } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import {
		aggregatePersonalAuthorRatings,
		buildPersonalMapNeighborhood,
		personalTasteCenter,
		type RatedBook
	} from '$lib/lab/author-taste/personal';
	import NavStyleTabList from '$lib/components/NavStyleTabList.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import AuthorMap from '$lib/components/lab/AuthorMap.svelte';
	import AuthorPicker from '$lib/components/lab/AuthorPicker.svelte';
	import ComparePanel from '$lib/components/lab/ComparePanel.svelte';
	import CommunityLegend from '$lib/components/lab/CommunityLegend.svelte';
	import ConnectionTable from '$lib/components/lab/ConnectionTable.svelte';
	import {
		availability,
		communityMembers,
		landmarkAuthors,
		normaliseName,
		oneSidedAuthors,
		subcommunityMembers
	} from '$lib/lab/author-taste/authors';
	import {
		ConnectionStore,
		loadNeighbourhood,
		type Neighbourhood
	} from '$lib/lab/author-taste/client';
	import { ConnectionFormatError } from '$lib/lab/author-taste/decode';
	import {
		compareAuthorsEdge,
		ComparisonError,
		type PairComparison
	} from '$lib/lab/author-taste/comparison';
	import { getSupabase } from '$lib/supabase';
	import { loadRelease, type Release } from '$lib/lab/author-taste/release';
	import {
		hasConnections,
		subcommunityKey,
		type Author,
		type Community,
		type Connection,
		type Subcommunity
	} from '$lib/lab/author-taste/types';

	type Mode = 'browse' | 'compare';

	let release = $state<Release | null>(null);
	let store: ConnectionStore | null = null;
	let loadError = $state<string | null>(null);
	const footerSupplement = getFooterSupplementContext();
	const footerSupplementOwner = Symbol('author-connections');
	let releaseRequestId = 0;
	let pageDestroyed = false;

	/*
	 * Browse leads. The release's own headline is its directionality catalogue — 1,262 pairs
	 * where the evidence supports influence running one way and not back — and that lives in a
	 * neighbourhood, not in a two-author comparison. Compare is the second tab rather than the
	 * first because it answers a narrower question.
	 */
	let mode = $state<Mode>('browse');

	// Browse mode
	let focus = $state<Author | null>(null);
	let neighbourhood = $state<Neighbourhood | null>(null);
	let neighbourhoodFocusId = $state<number | null>(null);
	let browsing = $state(false);
	let browseError = $state<string | null>(null);
	let browseRequestId = 0;
	let selectedCommunity = $state<Community | null>(null);
	let selectedSubcommunity = $state<Subcommunity | null>(null);

	// Compare mode
	let first = $state<Author | null>(null);
	let second = $state<Author | null>(null);
	let record = $state<PairComparison | null>(null);
	let comparing = $state(false);
	let compareError = $state<string | null>(null);
	let compareRequestId = 0;

	/** Fewer rows on a phone — legibility, not capability, is the constraint. */
	let connectionLimit = $state(24);

	let map = $state<ReturnType<typeof AuthorMap> | null>(null);
	let modeTabs = $state<HTMLDivElement | null>(null);
	let ratedBooks = $state<RatedBook[]>([]);
	let showPersonalRatings = $state(false);
	let tablePreviewAuthorId = $state<number | null>(null);

	const landmarks = $derived(release ? landmarkAuthors(release.index, 8) : []);
	const oneSidedSeeds = $derived(release ? oneSidedAuthors(release.index, 8) : []);
	const personalRatings = $derived.by(() =>
		release ? aggregatePersonalAuthorRatings(release.index, ratedBooks) : new Map()
	);
	const canShowPersonalRatings = $derived(!$isAnonymousOrSignedOut);
	const personalLayerVisible = $derived(showPersonalRatings && canShowPersonalRatings);
	const tasteCenter = $derived.by(() => {
		if (!release || !personalLayerVisible) return null;
		const neighborhood = buildPersonalMapNeighborhood(release.index, personalRatings.keys());
		return personalTasteCenter(release.index, personalRatings, neighborhood);
	});
	const highlighted = $derived(
		mode === 'compare' ? [first, second].filter((a): a is Author => a !== null) : []
	);
	/**
	 * The rows the table is showing, mirrored onto the map.
	 *
	 * `neighbourhood.connections` is every relationship the author has — 3,156 for the busiest —
	 * because the table needs the whole list to sort and filter over. Drawing all of those as
	 * spokes would bury the map, so the map follows what the table has narrowed to, and the
	 * table's sort and filter controls steer both.
	 */
	let tableRows = $state<Connection[]>([]);
	/** The table has published its initial visible set for this focus, including an empty set. */
	let tableRowsFocusId = $state<number | null>(null);
	const connections = $derived(
		mode === 'browse' &&
			focus &&
			neighbourhoodFocusId === focus.id &&
			neighbourhood &&
			!browsing &&
			!browseError
			? tableRows
			: []
	);
	const mapFramingReady = $derived(
		mode !== 'browse' ||
			focus === null ||
			!hasConnections(focus) ||
			browseError !== null ||
			tableRowsFocusId === focus.id
	);

	/**
	 * Flying the camera to a subgroup is not enough on its own to show which points belong to
	 * it — subgroups are not separated in space in every community, so the reader can arrive
	 * somewhere and still not see the group. Holding it lit against a receded background is
	 * what actually answers "which ones are these".
	 */
	const emphasis = $derived(
		mode === 'browse'
			? selectedSubcommunity
				? {
						communityId: selectedSubcommunity.communityId,
						subcommunityId: selectedSubcommunity.id
					}
				: selectedCommunity
					? { communityId: selectedCommunity.id, subcommunityId: null }
					: null
			: null
	);

	const tabItems = $derived([
		{ id: 'browse', label: t('lab.authorConnections.modes.browse') },
		{ id: 'compare', label: t('lab.authorConnections.modes.compare') }
	]);

	function describeError(error: unknown): string {
		if (error instanceof ConnectionFormatError) return t('lab.authorConnections.errors.format');
		if (error instanceof ComparisonError) return t('lab.authorConnections.errors.comparison');
		return t('lab.authorConnections.errors.shard');
	}

	async function runNeighbourhood(): Promise<void> {
		const requestId = ++browseRequestId;
		neighbourhood = null;
		neighbourhoodFocusId = null;
		tableRows = [];
		tableRowsFocusId = null;
		browseError = null;
		browsing = false;
		if (!store || !release || !focus) {
			return;
		}
		const focusId = focus.id;
		browsing = true;
		try {
			const result = await loadNeighbourhood(store, release.index, focus);
			if (requestId !== browseRequestId) return;
			neighbourhood = result;
			neighbourhoodFocusId = focusId;
		} catch (error) {
			if (requestId !== browseRequestId) return;
			browseError = describeError(error);
			neighbourhood = null;
		} finally {
			if (requestId === browseRequestId) browsing = false;
		}
	}

	function publishTableRows(focusId: number, rows: Connection[]): void {
		if (focus?.id !== focusId) return;
		tableRows = rows;
		tableRowsFocusId = focusId;
	}

	async function runComparison(): Promise<void> {
		if (!first || !second || first.id === second.id) {
			record = null;
			return;
		}
		const supabase = getSupabase();
		if (!supabase) {
			compareError = t('lab.authorConnections.errors.comparison');
			record = null;
			return;
		}

		const requestId = ++compareRequestId;
		comparing = true;
		compareError = null;
		try {
			const result = await compareAuthorsEdge(supabase, first.id, second.id);
			if (requestId !== compareRequestId) return;
			record = result;
		} catch (error) {
			if (requestId !== compareRequestId) return;
			compareError = describeError(error);
			record = null;
		} finally {
			if (requestId === compareRequestId) comparing = false;
		}
	}

	function selectFromMap(author: Author): void {
		if (mode === 'browse') {
			focus = author;
			return;
		}
		// Compare mode: fill the empty slot, otherwise replace the second author.
		if (!first) first = author;
		else if (author.id !== first.id) second = author;
	}

	function compareFromTable(author: Author): void {
		if (!focus || author.id === focus.id) return;
		first = focus;
		second = author;
		mode = 'compare';
		void focusActiveModeTab();
	}

	async function focusActiveModeTab(): Promise<void> {
		await tick();
		modeTabs?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
	}

	function chooseCommunity(community: Community | null): void {
		selectedCommunity = community;
		// Nested ids only mean anything inside their parent, so changing parent always clears it.
		selectedSubcommunity = null;
		if (!release || !map) return;
		map.frameAuthors(
			community ? communityMembers(release.index, community.id) : release.index.mapped
		);
	}

	function chooseSubcommunity(subcommunity: Subcommunity | null): void {
		selectedSubcommunity = subcommunity;
		if (!release || !map) return;
		if (!subcommunity) {
			map.frameAuthors(
				selectedCommunity
					? communityMembers(release.index, selectedCommunity.id)
					: release.index.mapped
			);
			return;
		}
		map.frameAuthors(subcommunityMembers(release.index, subcommunity.communityId, subcommunity.id));
	}

	/**
	 * Focus a representative author named in a subgroup profile.
	 *
	 * The profiles cite names, not ids, so this goes through the normalised-name index. A name
	 * that does not resolve is ignored rather than clearing the current focus.
	 */
	function focusAuthorNamed(name: string): void {
		const found = release?.index.byName.get(normaliseName(name));
		if (found) focus = found;
	}

	function clearPair(): void {
		first = null;
		second = null;
		record = null;
	}

	function togglePersonalRatings(): void {
		if (!canShowPersonalRatings) return;
		showPersonalRatings = !showPersonalRatings;
	}

	function clearFocus(): void {
		focus = null;
		neighbourhood = null;
	}

	/*
	 * Escape undoes the most recent selection, not the innermost one.
	 *
	 * Nesting order looks tidy until the levels are picked out of order. Choosing a community,
	 * then a subgroup, then one of its representative authors leaves three selections stacked —
	 * and focusing an author hides the legend, so unwinding by nesting order silently clears two
	 * things the reader can no longer see before finally releasing the author they just clicked.
	 * A sequence number per level makes the key behave like an undo in every order.
	 *
	 * Plain variables rather than `$state`: they are read only inside `clearSelection`, so
	 * stamping them from an effect cannot loop.
	 */
	let selectionCounter = 0;
	let focusSeq = 0;
	let pairSeq = 0;
	let communitySeq = 0;
	let subcommunitySeq = 0;

	function clearSelection(): void {
		const levels = [
			{ seq: subcommunitySeq, clear: () => chooseSubcommunity(null) },
			{ seq: communitySeq, clear: () => chooseCommunity(null) },
			{
				seq: mode === 'browse' ? focusSeq : pairSeq,
				clear: mode === 'browse' ? clearFocus : clearPair
			}
		].filter((level) => level.seq > 0);

		if (levels.length === 0) return;
		levels.sort((a, b) => b.seq - a.seq);
		levels[0].clear();
	}

	function attempt(): void {
		const requestId = ++releaseRequestId;
		loadError = null;
		release = null;
		store = null;
		footerSupplement?.clear(footerSupplementOwner);
		void loadRelease()
			.then((loaded) => {
				if (pageDestroyed || requestId !== releaseRequestId) return;
				release = loaded;
				store = new ConnectionStore(loaded);
			})
			.catch(() => {
				if (pageDestroyed || requestId !== releaseRequestId) return;
				release = null;
				store = null;
				footerSupplement?.clear(footerSupplementOwner);
				loadError = t('lab.authorConnections.errors.load');
			});
	}

	onMount(() => {
		const unsubscribeRatings = ratingsStore.ratedBooks.subscribe((entries) => {
			ratedBooks = entries;
		});
		const media = window.matchMedia('(min-width: 768px)');
		const applyLimit = () => (connectionLimit = media.matches ? 24 : 10);
		applyLimit();
		media.addEventListener('change', applyLimit);

		// Escape clears the selection from anywhere on the page, not only when the map happens
		// to hold focus — after clicking a point, focus is on the map, but after picking from
		// the search box or a community chip it is not, and the key should still work.
		const onKeydown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			// Leave the author search alone: there, Escape closes the suggestion list.
			if (event.target instanceof HTMLInputElement) return;
			clearSelection();
		};
		window.addEventListener('keydown', onKeydown);

		attempt();

		return () => {
			unsubscribeRatings();
			media.removeEventListener('change', applyLimit);
			window.removeEventListener('keydown', onKeydown);
		};
	});

	// Selection is fixed upstream, so a neighbourhood reloads only when the author changes —
	// there is no threshold for the reader to move and nothing to reclassify.
	$effect(() => {
		void focus?.id;
		void store;
		void runNeighbourhood();
	});

	$effect(() => {
		void first?.id;
		void second?.id;
		void store;
		void runComparison();
	});

	$effect(() => {
		if (!canShowPersonalRatings) showPersonalRatings = false;
	});

	$effect(() => {
		void mode;
		void focus?.id;
		tablePreviewAuthorId = null;
	});

	$effect(() => {
		if (!release) {
			footerSupplement?.clear(footerSupplementOwner);
			return;
		}
		footerSupplement?.set(
			footerSupplementOwner,
			t('lab.authorConnections.about.provenance', {
				version: release.manifest.version,
				map: release.manifest.sources.map_version,
				graph: release.manifest.sources.author_graph_version
			})
		);
	});

	onDestroy(() => {
		pageDestroyed = true;
		releaseRequestId += 1;
		footerSupplement?.clear(footerSupplementOwner);
	});

	/*
	 * Stamp each level as it is chosen, so Escape can release them newest-first. A level that
	 * goes away resets to 0 and drops out of the running.
	 */
	$effect(() => {
		focusSeq = focus ? ++selectionCounter : 0;
	});
	$effect(() => {
		pairSeq = first || second ? ++selectionCounter : 0;
	});
	$effect(() => {
		communitySeq = selectedCommunity ? ++selectionCounter : 0;
	});
	$effect(() => {
		subcommunitySeq = selectedSubcommunity ? ++selectionCounter : 0;
	});
</script>

<svelte:head>
	<title>{t('lab.authorConnections.title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('lab.authorConnections.metaDescription')} />
</svelte:head>

<div class="ac-page">
	<header class="ac-page__header">
		<h1 class="ac-page__title typ-display2 typ-display2--content">
			{t('lab.authorConnections.title')}
		</h1>
		{#if release}
			<div class="ac-page__mode-tabs" bind:this={modeTabs}>
				<NavStyleTabList
					items={tabItems}
					selectedId={mode}
					ariaLabel={t('lab.authorConnections.title')}
					panelId="ac-panel"
					idPrefix="ac-mode"
					showCounts={false}
					onSelect={(id) => (mode = id as Mode)}
				/>
			</div>
		{/if}
	</header>

	{#if loadError}
		<div class="ac-page__error" role="alert">
			<p>{loadError}</p>
			<button type="button" class="btn btn--secondary btn--compact" onclick={attempt}>
				{t('lab.authorConnections.errors.retry')}
			</button>
		</div>
	{:else if !release}
		<div class="ac-page__loading">
			<Spinner />
			<p>{t('lab.authorConnections.loading.authors')}</p>
		</div>
	{:else}
		<div
			class="ac-page__workbench"
			class:ac-page__workbench--compare={mode === 'compare'}
			class:ac-page__workbench--selected={mode === 'browse' && focus !== null}
			id="ac-panel"
			role="tabpanel"
			aria-labelledby="ac-mode-{mode}"
		>
			<div class="ac-page__map-column">
				<AuthorMap
					bind:this={map}
					index={release.index}
					focus={mode === 'browse' ? focus : null}
					{connections}
					{highlighted}
					{emphasis}
					previewAuthorId={tablePreviewAuthorId}
					framingReady={mapFramingReady}
					personalRatings={canShowPersonalRatings ? personalRatings : new Map()}
					showPersonalRatings={personalLayerVisible}
					tasteCenter={canShowPersonalRatings ? tasteCenter : null}
					onTogglePersonalRatings={canShowPersonalRatings ? togglePersonalRatings : undefined}
					onSelectAuthor={selectFromMap}
					onClearSelection={clearSelection}
				/>
			</div>

			<aside
				class="ac-page__inspector"
				class:ac-page__inspector--selected={mode === 'browse' && focus !== null}
			>
				<div
					class="ac-page__inspector-view"
					hidden={mode !== 'browse'}
					aria-hidden={mode !== 'browse'}
				>
					<div class="ac-page__browse" class:ac-page__browse--selected={focus !== null}>
						{#if !focus}
							<div class="ac-page__seed">
								<AuthorPicker
									index={release.index}
									id="ac-focus-author"
									label={t('lab.authorConnections.browse.searchLabel')}
									hideLabel
									selected={null}
									onSelect={(author) => (focus = author)}
								/>

								<!-- Recognisable names first: the readiest way in for someone with no author in mind. -->
								<h2 class="ac-page__seed-heading typ-h3">
									{t('lab.authorConnections.browse.landmarks')}
								</h2>
								<ul class="ac-page__chips">
									{#each landmarks as author (author.id)}
										<li>
											<button
												type="button"
												class="btn btn--secondary btn--compact"
												onclick={() => (focus = author)}
											>
												{author.name}
											</button>
										</li>
									{/each}
								</ul>

								<h2 class="ac-page__seed-heading typ-h3">
									{t('lab.authorConnections.browse.oneSidedSeeds')}
								</h2>
								<ul class="ac-page__chips">
									{#each oneSidedSeeds as author (author.id)}
										<li>
											<button
												type="button"
												class="btn btn--secondary btn--compact"
												onclick={() => (focus = author)}
											>
												{author.name}
											</button>
										</li>
									{/each}
								</ul>
							</div>
						{:else}
							<div class="ac-page__selected">
								<div class="ac-page__selected-summary">
									<div class="ac-page__focus-bar">
										<div class="ac-page__focus-identity">
											<p class="ac-page__focus-name">{focus.name}</p>
											<p class="ac-page__focus-meta">
												{focus.genre}
												{#if release.index.communityById.get(focus.communityId)}
													<span class="ac-page__dot">·</span>
													{release.index.communityById.get(focus.communityId)?.label}
													{#if release.index.subcommunityByKey.get(subcommunityKey(focus.communityId, focus.subcommunityId))}
														<span class="ac-page__dot">›</span>
														{release.index.subcommunityByKey.get(
															subcommunityKey(focus.communityId, focus.subcommunityId)
														)?.label}
													{/if}
												{/if}
											</p>
											{#if focus.sampleTitles.length > 0}
												<p class="ac-page__focus-titles">
													{focus.sampleTitles.slice(0, 3).join(' · ')}
												</p>
											{/if}
											{#if availability(focus) !== 'both'}
												<p class="ac-page__focus-availability">
													{t(`lab.authorConnections.availability.${availability(focus)}`)}
												</p>
											{/if}
										</div>
										<button
											type="button"
											class="btn btn--tertiary btn--compact"
											onclick={clearFocus}
										>
											{t('lab.authorConnections.compare.clear')}
										</button>
									</div>

									{#if neighbourhood && neighbourhoodFocusId === focus.id && !browsing && !browseError && hasConnections(focus)}
										<div class="ac-page__tallies">
											<p>
												{t('lab.authorConnections.browse.tally', {
													total: neighbourhood.total.toLocaleString(),
													oneSided: neighbourhood.oneSidedTotal.toLocaleString(),
													opposing: neighbourhood.opposingTotal.toLocaleString()
												})}
											</p>
										</div>
									{/if}
								</div>

								<div class="ac-page__relationship-region">
									<h3 class="ac-page__relationship-heading typ-h3">
										{t('lab.authorConnections.table.heading')}
									</h3>
									{#if browseError}
										<div class="ac-page__error" role="alert">
											<p>{browseError}</p>
											<button
												type="button"
												class="btn btn--secondary btn--compact"
												onclick={() => void runNeighbourhood()}
											>
												{t('lab.authorConnections.errors.retry')}
											</button>
										</div>
									{:else if browsing}
										<div class="ac-page__loading">
											<Spinner />
											<p>{t('lab.authorConnections.loading.connections')}</p>
										</div>
									{:else if !hasConnections(focus)}
										<!-- A dead end needs a way out, not just an explanation of why it is one. -->
										<div class="ac-page__seed">
											<p class="ac-page__help">
												{t('lab.authorConnections.browse.noConnections', { author: focus.name })}
											</p>
											<p class="ac-page__help">
												{t('lab.authorConnections.browse.noConnectionsAction')}
											</p>
											<ul class="ac-page__chips">
												{#each oneSidedSeeds.slice(0, 6) as author (author.id)}
													<li>
														<button
															type="button"
															class="btn btn--secondary btn--compact"
															onclick={() => (focus = author)}
														>
															{author.name}
														</button>
													</li>
												{/each}
											</ul>
										</div>
									{:else if neighbourhood && neighbourhoodFocusId === focus.id}
										{#key focus.id}
											<ConnectionTable
												{focus}
												connections={neighbourhood.connections}
												limit={connectionLimit}
												onVisibleRowsChange={publishTableRows}
												onCompareAuthor={compareFromTable}
												onPreviewAuthor={(author) => (tablePreviewAuthorId = author?.id ?? null)}
											/>
										{/key}
									{/if}
								</div>
							</div>
						{/if}

						<!--
					Only while nothing is selected. Once an author is in focus the page is about them,
					and a second selectable grouping alongside their relationships just competes.
				-->
						{#if !focus}
							<CommunityLegend
								communities={release.index.communities}
								subcommunitiesByCommunity={release.index.subcommunitiesByCommunity}
								selectedCommunityId={selectedCommunity?.id ?? null}
								selectedSubcommunityId={selectedSubcommunity?.id ?? null}
								onSelectCommunity={chooseCommunity}
								onSelectSubcommunity={chooseSubcommunity}
								onSelectAuthorNamed={focusAuthorNamed}
							/>
						{/if}
					</div>
				</div>

				<div
					class="ac-page__inspector-view"
					hidden={mode !== 'compare'}
					aria-hidden={mode !== 'compare'}
				>
					<div class="ac-page__compare">
						<div class="ac-page__compare-pickers">
							<p class="ac-page__mode-hint">{t('lab.authorConnections.modes.compareHint')}</p>
							<div class="ac-page__pickers">
								<AuthorPicker
									index={release.index}
									id="ac-first-author"
									label={t('lab.authorConnections.compare.firstAuthor')}
									selected={first}
									onSelect={(author) => (first = author)}
								/>
								<AuthorPicker
									index={release.index}
									id="ac-second-author"
									label={t('lab.authorConnections.compare.secondAuthor')}
									selected={second}
									onSelect={(author) => (second = author)}
								/>
								<div class="ac-page__buttons">
									<button
										type="button"
										class="btn btn--tertiary btn--compact"
										onclick={clearPair}
										disabled={!first && !second}
									>
										{t('lab.authorConnections.compare.clear')}
									</button>
								</div>
							</div>
						</div>

						<div class="ac-page__compare-result">
							<ComparePanel
								{first}
								{second}
								{record}
								loading={comparing}
								error={compareError}
								onRetry={() => void runComparison()}
							/>
						</div>
					</div>
				</div>
			</aside>
		</div>
	{/if}
</div>

<style>
	.ac-page {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: var(--space-5);
		width: 100%;
		min-width: 0;
		min-height: 0;
		container: author-connections / inline-size;
	}
	.ac-page__header {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: flex-start;
		text-align: left;
	}
	.ac-page__title {
		margin: 0;
	}
	.ac-page__mode-hint {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.45;
		color: var(--color-text-muted);
	}
	.ac-page__compare {
		display: flex;
		flex-direction: column;
		gap: 0;
		min-width: 0;
	}
	.ac-page__pickers {
		display: grid;
		gap: var(--space-2);
		align-items: end;
	}
	@media (min-width: 48rem) {
		.ac-page__pickers {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
		}
	}
	.ac-page__buttons {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.ac-page__help {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.5;
		color: var(--color-text-muted);
	}
	.ac-page__browse {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
		padding: var(--space-4);
	}
	.ac-page__seed {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.ac-page__seed-heading {
		margin: var(--space-1) 0 0;
	}
	.ac-page__chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.ac-page__focus-bar {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-2) 0 var(--space-4);
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--color-border);
		border-radius: 0;
	}
	.ac-page__focus-identity {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.ac-page__focus-bar p {
		margin: 0;
	}
	.ac-page__focus-name {
		font-family: var(--typ-h3-font-family);
		font-size: var(--primitive-type-size-20);
		letter-spacing: var(--typ-h3-letter-spacing);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}
	.ac-page__focus-meta,
	.ac-page__focus-titles {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}
	.ac-page__focus-availability {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text);
	}
	.ac-page__dot {
		padding: 0 var(--space-1);
	}
	.ac-page__tallies {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.ac-page__tallies p {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
	}
	.ac-page__loading {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-6) 0;
		color: var(--color-text-muted);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
	}
	.ac-page__loading p {
		margin: 0;
	}
	.ac-page__error {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: flex-start;
		padding: var(--space-4);
		background: var(--color-error-bg);
		border: 1px solid var(--color-error-border);
		border-radius: var(--radius);
		color: var(--color-error-text);
	}
	.ac-page__error p {
		margin: 0;
	}
	/* Observatory shell: the map and its inspector share one measured instrument surface. */
	.ac-page__mode-tabs {
		width: 100%;
		min-width: 0;
	}
	.ac-page__mode-tabs :global(.nav-style-tabs__list) {
		justify-content: flex-start;
	}
	.ac-page__workbench {
		display: grid;
		flex: 1 1 auto;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas:
			'map'
			'inspector';
		gap: var(--space-5);
		min-width: 0;
		min-height: 0;
	}
	.ac-page__inspector-view {
		min-width: 0;
		min-height: 0;
	}
	.ac-page__map-column {
		grid-area: map;
		min-width: 0;
	}
	.ac-page__inspector {
		grid-area: inspector;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card-bg);
	}
	.ac-page__browse--selected {
		min-height: 0;
	}
	.ac-page__selected {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		min-height: 0;
	}
	.ac-page__selected-summary {
		flex: 0 0 auto;
		min-width: 0;
	}
	.ac-page__relationship-region {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		min-height: clamp(20rem, 56dvh, 36rem);
		padding-top: var(--space-1);
	}
	.ac-page__relationship-heading {
		flex: 0 0 auto;
		margin: 0;
		color: var(--color-text);
	}
	.ac-page__relationship-region :global(.connection-table) {
		min-height: 0;
	}
	.ac-page__compare-pickers {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card-bg);
	}
	.ac-page__compare-result {
		padding: var(--space-4);
	}
	@container author-connections (min-width: 48rem) and (max-width: 69.99rem) {
		.ac-page__mode-tabs {
			width: max-content;
			max-width: 100%;
		}
		.ac-page__mode-tabs :global(.nav-style-tabs__list) {
			justify-content: flex-start;
		}
	}

	@container author-connections (min-width: 70rem) {
		.ac-page__header {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			gap: var(--space-5);
		}
		.ac-page__mode-tabs {
			width: max-content;
			max-width: 50%;
			margin-left: auto;
		}
		.ac-page__mode-tabs :global(.nav-style-tabs__list) {
			justify-content: flex-end;
		}
		.ac-page__workbench {
			grid-template-columns: minmax(0, 58fr) minmax(19rem, 42fr);
			grid-template-rows: minmax(0, 1fr);
			grid-template-areas: 'map inspector';
			column-gap: var(--space-5);
			min-height: 36rem;
			align-items: stretch;
		}
		.ac-page__map-column,
		.ac-page__inspector {
			height: 100%;
			min-height: 0;
		}
		.ac-page__inspector {
			overflow: auto;
			overflow-x: hidden;
			overscroll-behavior: contain;
		}
		.ac-page__compare-pickers {
			position: sticky;
			top: 0;
			z-index: 2;
		}
		.ac-page__pickers {
			grid-template-columns: minmax(0, 1fr);
			align-items: stretch;
		}
		.ac-page__workbench--selected .ac-page__inspector.ac-page__inspector--selected {
			overflow: hidden;
		}
		.ac-page__inspector--selected .ac-page__inspector-view:not([hidden]) {
			height: 100%;
			min-height: 0;
		}
		.ac-page__browse--selected {
			height: 100%;
			min-height: 0;
			gap: 0;
		}
		.ac-page__selected {
			height: 100%;
		}
		.ac-page__relationship-region {
			flex: 1 1 auto;
			min-height: 0;
			overflow: hidden;
		}
		.ac-page__relationship-region :global(.connection-table) {
			display: flex;
			flex: 1 1 auto;
			min-height: 0;
		}
		.ac-page__relationship-region :global(.connection-table__scroll) {
			flex: 1 1 auto;
			min-height: 0;
			max-height: none;
		}
	}

	@media (max-width: 47.99rem) {
		.ac-page__workbench {
			gap: var(--space-4);
		}
	}
</style>
