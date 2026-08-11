<script lang="ts">
	import { t } from '$lib/copy';
	import MetricTooltip from './MetricTooltip.svelte';
	import { composeDefaultOrder, statusRank } from '$lib/lab/author-taste/client';
	import { normaliseName } from '$lib/lab/author-taste/authors';
	import {
		formatInterval,
		formatPercentagePoints,
		formatQValue,
		formatRate,
		formatRelativeLikelihood,
		relativeDirectionColorWeight,
		relativeLikelihoodPercent
	} from '$lib/lab/author-taste/format';
	import {
		STATUS_KEYS,
		type Author,
		type Connection,
		type DirectionEstimate
	} from '$lib/lab/author-taste/types';

	interface Props {
		focus: Author;
		/** Every relationship for the focus author. Sorting across a pre-cut list would be a lie. */
		connections: Connection[];
		/** How many rows to draw at once. */
		limit: number;
		/**
		 * The rows currently on screen, published back out so the map can draw exactly the same
		 * set. Without it the map would draw a spoke for every relationship the author has —
		 * thousands, for a popular one — while the table showed two dozen.
		 */
		visibleRows?: Connection[];
		onSelectAuthor: (author: Author) => void;
	}

	let { focus, connections, limit, visibleRows = $bindable([]), onSelectAuthor }: Props = $props();

	/**
	 * The keyboard- and screen-reader-equivalent view of the map. Every author drawn on the
	 * canvas is reachable here as a real button, so nothing on the map is pointer-only — and
	 * the 1,240 authors that carry evidence without appearing on the map are only reachable
	 * here at all.
	 */
	type SortKey = 'default' | 'verdict' | 'outward' | 'inward';

	let sortKey = $state<SortKey>('default');
	let sortDescending = $state(false);
	let authorQuery = $state('');
	let genreQuery = $state('');

	/** Rarest verdict first; biggest effect first. Whichever reads as "most interesting". */
	const NATURAL_DESCENDING: Record<Exclude<SortKey, 'default'>, boolean> = {
		verdict: false,
		outward: true,
		inward: true
	};

	function toggleSort(key: Exclude<SortKey, 'default'>): void {
		if (sortKey === key) {
			sortDescending = !sortDescending;
			return;
		}
		sortKey = key;
		sortDescending = NATURAL_DESCENDING[key];
	}

	function compare(a: Connection, b: Connection): number {
		switch (sortKey) {
			case 'verdict':
				return statusRank(a) - statusRank(b);
			case 'outward':
				return compareRelative(a.record.self, b.record.self);
			case 'inward':
				return compareRelative(a.record.reverse, b.record.reverse);
			default:
				return 0;
		}
	}

	function relativeDifference(estimate: DirectionEstimate): number | null {
		return relativeLikelihoodPercent(estimate.likeRate, estimate.baselineRate);
	}

	function compareRelative(a: DirectionEstimate, b: DirectionEstimate): number {
		const first = relativeDifference(a);
		const second = relativeDifference(b);
		if (first === second) return 0;
		if (first === null) return -1;
		if (second === null) return 1;
		return first < second ? -1 : 1;
	}

	/** Accent- and case-insensitive, matching how the author search behaves elsewhere. */
	function matches(value: string, query: string): boolean {
		const needle = normaliseName(query);
		return !needle || normaliseName(value).includes(needle);
	}

	const byAuthor = $derived(
		connections.filter((connection) => matches(connection.other.name, authorQuery))
	);

	/**
	 * Genres are a closed list of seventeen, so the column filters by picking rather than by
	 * typing. Only genres actually present are offered — an option that can only ever return
	 * nothing is not a choice.
	 */
	const genreOptions = $derived(
		[...new Set(byAuthor.map((connection) => connection.other.genre))].sort((a, b) =>
			a.localeCompare(b)
		)
	);

	const filtered = $derived(
		byAuthor.filter((connection) => !genreQuery || connection.other.genre === genreQuery)
	);

	/**
	 * Names to offer while typing, drawn from this author's own relationships. A native
	 * `datalist` keeps the keyboard and screen-reader behaviour the browser already provides;
	 * the cap keeps the option list short for authors with thousands of relationships.
	 */
	const SUGGESTION_LIMIT = 20;
	const suggestions = $derived(
		filtered.slice(0, SUGGESTION_LIMIT).map((connection) => connection.other.name)
	);
	const suggestionsId = $derived(`connection-table-authors-${focus.id}`);

	const rows = $derived.by(() => {
		if (sortKey === 'default') return composeDefaultOrder(filtered, limit);
		const sorted = [...filtered].sort(compare);
		if (sortDescending) sorted.reverse();
		return sorted.slice(0, limit);
	});

	// Nothing here reads `visibleRows`, so publishing it cannot feed back into `rows`.
	$effect(() => {
		visibleRows = rows;
	});

	function statusLabel(connection: Connection): string {
		return t(`lab.authorConnections.status.${STATUS_KEYS[connection.record.status]}.short`);
	}

	function directionColor(relativePercent: number | null, selected: boolean): string {
		const weight = relativeDirectionColorWeight(relativePercent, selected);
		if (weight === null) return 'var(--color-text-muted)';
		const hue =
			relativePercent !== null && relativePercent < 0
				? 'var(--color-viz-conflict)'
				: 'var(--color-viz-affinity)';
		return `color-mix(in srgb, ${hue} ${weight}%, var(--color-text-muted))`;
	}

	function relativeAriaLabel(relativePercent: number | null): string {
		if (relativePercent === null || Number.isNaN(relativePercent)) {
			return t('lab.authorConnections.hover.insufficient');
		}
		if (relativePercent === Number.POSITIVE_INFINITY || relativePercent > 100) {
			return t('lab.authorConnections.hover.overCap');
		}
		const value = Math.round(Math.abs(relativePercent));
		if (value === 0) return t('lab.authorConnections.hover.sameLikelihood');
		return t(
			relativePercent > 0
				? 'lab.authorConnections.hover.moreLikely'
				: 'lab.authorConnections.hover.lessLikely',
			{ value }
		);
	}

	function cappedRelativeDetail(relativePercent: number | null): string | null {
		if (relativePercent === Number.POSITIVE_INFINITY) {
			return t('lab.authorConnections.hover.zeroBaseline');
		}
		if (relativePercent !== null && Number.isFinite(relativePercent) && relativePercent > 100) {
			return `+${relativePercent.toFixed(1)}%`;
		}
		return null;
	}

	/**
	 * Column headings, each with the sentence that explains it, plus whether it can be sorted
	 * or searched.
	 *
	 * The explanation is both a `title` for pointer users and visually hidden text inside the
	 * header cell, so a screen reader reads it as part of the column name. A `title` alone is
	 * hover-only and announced inconsistently.
	 */
	interface Column {
		key: string;
		label: string;
		sort?: Exclude<SortKey, 'default'>;
		search?: 'author' | 'genre';
		about: string;
	}

	const columns = $derived(
		(
			[
				{ key: 'author', label: t('lab.authorConnections.table.author'), search: 'author' },
				{ key: 'verdict', label: t('lab.authorConnections.table.verdict'), sort: 'verdict' },
				{
					key: 'outward',
					label: t('lab.authorConnections.table.outward', { author: focus.name }),
					sort: 'outward'
				},
				{
					key: 'inward',
					label: t('lab.authorConnections.table.inward', { author: focus.name }),
					sort: 'inward'
				},
				{ key: 'genre', label: t('lab.authorConnections.table.genre'), search: 'genre' }
			] as Omit<Column, 'about'>[]
		).map(
			(column): Column => ({
				...column,
				about: t(`lab.authorConnections.table.about.${column.key}`)
			})
		)
	);

	function ariaSort(key: string | undefined): 'ascending' | 'descending' | 'none' {
		if (!key || sortKey !== key) return 'none';
		return sortDescending ? 'descending' : 'ascending';
	}
</script>

<div class="connection-table">
	<h3 class="connection-table__heading typ-h3">{t('lab.authorConnections.table.heading')}</h3>
	<div class="connection-table__scroll">
		<table>
			<caption class="connection-table__caption">
				{t('lab.authorConnections.table.caption')}
			</caption>
			<thead>
				<tr>
					{#each columns as column (column.key)}
						<th scope="col" aria-sort={ariaSort(column.sort)}>
							<span class="connection-table__head">
								{#if column.sort}
									{@const key = column.sort}
									<button
										type="button"
										class="connection-table__sort"
										class:connection-table__sort--active={sortKey === key}
										aria-label={t('lab.authorConnections.table.sortBy', { column: column.label })}
										onclick={() => toggleSort(key)}
									>
										{column.label}
										<span class="connection-table__arrow" aria-hidden="true">
											{sortKey === column.sort ? (sortDescending ? '↓' : '↑') : '↕'}
										</span>
									</button>
								{:else}
									{column.label}
								{/if}
								<span class="connection-table__info" title={column.about} aria-hidden="true">i</span
								>
								<span class="connection-table__sr-only">{column.about}</span>
							</span>
							{#if column.search === 'author'}
								<input
									type="search"
									class="connection-table__filter"
									list={suggestionsId}
									autocomplete="off"
									placeholder={t('lab.authorConnections.table.searchAuthor')}
									aria-label={t('lab.authorConnections.table.searchAuthor')}
									bind:value={authorQuery}
								/>
								<datalist id={suggestionsId}>
									{#each suggestions as name (name)}
										<option value={name}></option>
									{/each}
								</datalist>
							{:else if column.search === 'genre'}
								<select
									class="connection-table__filter"
									aria-label={t('lab.authorConnections.table.filterGenre')}
									bind:value={genreQuery}
								>
									<option value="">{t('lab.authorConnections.table.allGenres')}</option>
									{#each genreOptions as genre (genre)}
										<option value={genre}>{genre}</option>
									{/each}
								</select>
							{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as connection (connection.other.id)}
					{@const record = connection.record}
					{@const oneSided = record.status === 2 || record.status === 3}
					{@const outwardRelative = relativeDifference(record.self)}
					{@const inwardRelative = relativeDifference(record.reverse)}
					{@const outwardCappedDetail = cappedRelativeDetail(outwardRelative)}
					{@const inwardCappedDetail = cappedRelativeDetail(inwardRelative)}
					<tr>
						<th scope="row">
							<button
								type="button"
								class="connection-table__author"
								onclick={() => onSelectAuthor(connection.other)}
							>
								{connection.other.name}
							</button>
						</th>
						<td class:connection-table__verdict--one-sided={oneSided}>
							{statusLabel(connection)}
						</td>
						<td
							class="connection-table__effect"
							style:--direction-color={directionColor(outwardRelative, record.self.selected)}
						>
							<MetricTooltip
								id="connection-{focus.id}-{connection.other.id}-outward-stats"
								ariaLabel={relativeAriaLabel(outwardRelative)}
								metrics={[
									...(outwardCappedDetail === null
										? []
										: [
												{
													label: t('lab.authorConnections.hover.relativeDifference'),
													value: outwardCappedDetail
												}
											]),
									{
										label: t('lab.authorConnections.hover.readerRate', {
											author: focus.name
										}),
										value: formatRate(record.self.likeRate)
									},
									{
										label: t('lab.authorConnections.hover.otherReaderRate'),
										value: formatRate(record.self.baselineRate)
									},
									{
										label: t('lab.authorConnections.hover.pointDifference'),
										value: formatPercentagePoints(record.self.rateDifference * 100)
									},
									{
										label: t('lab.authorConnections.hover.pointDifferenceCi'),
										value: formatInterval(record.self.ciLower, record.self.ciUpper)
									},
									{
										label: t('lab.authorConnections.hover.qValue'),
										value: formatQValue(record.self.negLog10Q)
									}
								]}
							>
								{formatRelativeLikelihood(outwardRelative)}
							</MetricTooltip>
						</td>
						<td
							class="connection-table__effect"
							style:--direction-color={directionColor(inwardRelative, record.reverse.selected)}
						>
							<MetricTooltip
								id="connection-{focus.id}-{connection.other.id}-inward-stats"
								ariaLabel={relativeAriaLabel(inwardRelative)}
								metrics={[
									...(inwardCappedDetail === null
										? []
										: [
												{
													label: t('lab.authorConnections.hover.relativeDifference'),
													value: inwardCappedDetail
												}
											]),
									{
										label: t('lab.authorConnections.hover.readerRate', {
											author: connection.other.name
										}),
										value: formatRate(record.reverse.likeRate)
									},
									{
										label: t('lab.authorConnections.hover.otherReaderRate'),
										value: formatRate(record.reverse.baselineRate)
									},
									{
										label: t('lab.authorConnections.hover.pointDifference'),
										value: formatPercentagePoints(record.reverse.rateDifference * 100)
									},
									{
										label: t('lab.authorConnections.hover.pointDifferenceCi'),
										value: formatInterval(record.reverse.ciLower, record.reverse.ciUpper)
									},
									{
										label: t('lab.authorConnections.hover.qValue'),
										value: formatQValue(record.reverse.negLog10Q)
									}
								]}
							>
								{formatRelativeLikelihood(inwardRelative)}
							</MetricTooltip>
						</td>
						<td>{connection.other.genre}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if rows.length === 0}
		<p class="connection-table__footnote">{t('lab.authorConnections.table.noMatches')}</p>
	{:else}
		<p class="connection-table__footnote">
			{t('lab.authorConnections.table.showing', {
				count: rows.length,
				total: filtered.length.toLocaleString()
			})}
			{#if sortKey === 'default'}
				{t('lab.authorConnections.table.defaultNote')}
			{/if}
		</p>
	{/if}
	<p class="connection-table__footnote">{t('lab.authorConnections.table.dimNote')}</p>
</div>

<style>
	.connection-table {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.connection-table__heading {
		color: var(--color-text);
	}
	/* Wide table scrolls inside its own container; the page body never scrolls sideways. */
	.connection-table__scroll {
		width: 100%;
		max-width: 100%;
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
	}
	.connection-table__caption {
		text-align: left;
		padding-bottom: var(--space-2);
		color: var(--color-text-muted);
	}
	th,
	td {
		padding: var(--space-2) var(--space-3);
		text-align: left;
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
	}
	thead th {
		color: var(--color-text-muted);
		font-weight: var(--primitive-font-weight-normal);
		vertical-align: top;
	}
	.connection-table__head {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	tbody th {
		font-weight: var(--primitive-font-weight-normal);
	}
	.connection-table__sort {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 0;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.connection-table__sort:hover {
		color: var(--color-text);
	}
	.connection-table__sort:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.connection-table__sort--active {
		color: var(--color-text);
	}
	.connection-table__arrow {
		font-size: var(--primitive-type-size-12, 0.75rem);
	}
	/* Sits under its heading so the control and the column it filters stay adjacent. */
	.connection-table__filter {
		width: 100%;
		min-width: 7rem;
		box-sizing: border-box;
		margin-top: var(--space-1);
		padding: var(--space-1) var(--space-2);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xs);
		color: var(--color-text);
		font-family: inherit;
		font-size: inherit;
		font-weight: var(--primitive-font-weight-normal);
	}
	.connection-table__filter:focus-visible {
		outline: none;
		border-color: var(--color-focus);
		box-shadow: var(--shadow-focus-input);
	}
	.connection-table__author {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-accent);
		font-family: inherit;
		font-size: inherit;
		text-align: left;
		cursor: pointer;
		text-decoration: underline;
	}
	.connection-table__author:hover {
		text-decoration: none;
	}
	.connection-table__author:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.connection-table__info {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		flex: none;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		font-size: var(--primitive-type-size-12, 0.75rem);
		font-style: italic;
		line-height: 1;
		cursor: help;
	}
	.connection-table__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
	.connection-table__effect {
		color: var(--direction-color);
		font-weight: var(--primitive-font-weight-semibold);
		font-variant-numeric: tabular-nums;
	}
	.connection-table__verdict--one-sided {
		color: var(--color-viz-map-focus);
	}
	.connection-table__footnote {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
	}
</style>
