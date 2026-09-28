<script lang="ts">
	import { t } from '$lib/copy';
	import {
		formatInterval,
		formatPValue,
		formatPercent,
		groupNumber,
		wilsonInterval
	} from '$lib/lab/recommendation-benchmark/format';
	import {
		SYSTEM_IDS,
		type BenchmarkSummary,
		type HitRow,
		type PopulationInfo,
		type SystemId
	} from '$lib/lab/recommendation-benchmark/types';

	interface Props {
		summary: BenchmarkSummary;
		populations: PopulationInfo[];
		/** Upper bounds of history groups 1–3; group 4 is everything above the last. */
		historyBoundaries: number[];
	}

	let { summary, populations, historyBoundaries }: Props = $props();

	/**
	 * Footnote marker for a bar or line covering only a subset of the shared readers (Hardcover's
	 * 100), explained under the chart. A separate cohort (Unread's 2,000) is described in
	 * "How it works" instead and carries no marker.
	 */
	type Mark = '' | '*';
	const MARK_ORDER: Record<Mark, number> = { '': 0, '*': 1 };

	const COPY = 'lab.recommendationBenchmark.';
	const SIGNIFICANCE = 0.05;

	function systemName(system: SystemId): string {
		return t(COPY + 'systems.' + system);
	}

	function populationLabel(info: PopulationInfo): string {
		return t(COPY + 'populations.' + info.id, {
			count: info.readers,
			min: info.history_min ?? '',
			max: info.history_max ?? ''
		});
	}

	const rows = $derived(summary.accuracy.rows);
	const allInfo = $derived(populations.find((population) => population.id === 'all'));

	/**
	 * One chart, one bar per system, each on the most readers it was tested on: Unread on the
	 * separate 2,000-reader cohort, ChatGPT on the shared 200, Hardcover on its 100. Every bar keeps
	 * the release's own Wilson interval; a bar off the shared 200 carries a marker explained under
	 * the chart. Like-for-like comparisons live in the head to head, not here.
	 */
	const chartRows = $derived(
		SYSTEM_IDS.flatMap((system) => {
			const row = rows
				.filter((candidate) => candidate.system === system)
				.reduce<HitRow | undefined>(
					(best, candidate) => (!best || candidate.users > best.users ? candidate : best),
					undefined
				);
			if (!row) return [];
			const info = populations.find((population) => population.id === row.population);
			const mark: Mark = row.population === 'all' || info?.direct_comparison === false ? '' : '*';
			/* A subset's caveat goes in its hover in the main chart, not in a footnote. */
			const note =
				mark && info
					? t(COPY + 'accuracy.partialTip', {
							system: systemName(system),
							users: row.users.toLocaleString(),
							// Word joiners keep "11–122" on one line when the note wraps.
							range: (info.history_min ?? '') + '\u2060–\u2060' + (info.history_max ?? '')
						})
					: null;
			return [{ row, info, mark, note, interval: row.ci95 }];
		}).sort((a, b) => MARK_ORDER[a.mark] - MARK_ORDER[b.mark])
	);

	/** Axis maximum: the next 5% above the widest interval, so every whisker fits. */
	function axisFor(intervals: Array<[number, number]>): number {
		const widest = Math.max(0, ...intervals.map((interval) => interval[1]));
		return Math.max(0.05, Math.ceil(widest * 20 + 1e-9) / 20);
	}

	function ticksFor(max: number): number[] {
		return Array.from({ length: Math.round(max * 20) + 1 }, (_, i) => i / 20);
	}

	function position(share: number, max: number): string {
		return (Math.min(share, max) / max) * 100 + '%';
	}

	const axisMax = $derived(axisFor(chartRows.map(({ interval }) => interval)));

	/**
	 * The bar whose details are open: while a mouse hovers it, while it has keyboard focus, or after
	 * a tap until focus moves elsewhere.
	 */
	let activeRate = $state<SystemId | null>(null);

	/** 2.27 → "2.3×", 3 → "3×". */
	function formatRatio(ratio: number): string {
		return Number(ratio.toFixed(1)).toString() + '×';
	}

	/**
	 * Headline under the main chart. It claims Unread outperformed the others, so it is shown only
	 * while that holds on the data: higher than every other system on that system's own readers
	 * (like for like), with every paired test below the significance threshold.
	 */
	const headline = $derived.by(() => {
		const others = chartRows.filter(({ row }) => row.system !== 'ours');
		if (others.length === 0) return null;
		const outperformed = others.every(({ row }) => {
			const ours = rows.find(
				(candidate) => candidate.system === 'ours' && candidate.population === row.population
			);
			const pair = summary.accuracy.paired.find(
				(candidate) =>
					(candidate.a === 'ours' && candidate.b === row.system) ||
					(candidate.b === 'ours' && candidate.a === row.system)
			);
			return (
				ours != null && ours.hit_rate > row.hit_rate && pair != null && pair.p_exact < SIGNIFICANCE
			);
		});
		return outperformed ? t(COPY + 'accuracy.intro', { ours: systemName('ours') }) : null;
	});

	/**
	 * Subtitle for the head to head: hits cluster on the same readers. Uses the pair asked about
	 * every reader and compares the readers both found with what independent hits would give
	 * (hits A × hits B / readers). Shown only when the overlap is clearly above chance.
	 */
	const overlap = $derived.by(() => {
		const total = allInfo?.readers;
		const pair = summary.accuracy.paired.find((candidate) => candidate.users === total);
		if (!pair || pair.both === 0) return null;
		const expected = ((pair.only_a + pair.both) * (pair.only_b + pair.both)) / pair.users;
		const ratio = pair.both / expected;
		if (!(ratio >= 1.5)) return null;
		return t(COPY + 'accuracy.pairsIntro', {
			a: systemName(pair.a),
			b: systemName(pair.b),
			both: pair.both,
			ratio: formatRatio(ratio)
		});
	});

	/** A count as a share of the pair's readers: 11 of 100 → "11%", 5 of 200 → "2.5%". */
	function shareOf(count: number, users: number): string {
		const value = (count / Math.max(1, users)) * 100;
		const rounded = Math.round(value * 10) / 10;
		return (Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)) + '%';
	}

	/** Grid column for one bar segment: proportional, wide enough for its label, or none. */
	function column(count: number, kind: string): string {
		if (count <= 0) return '0px';
		// The shared segment carries a word ("2.5% both"), so it needs a little more room.
		return 'minmax(' + (kind === 'both' ? '5.25rem' : '2.75rem') + ', ' + count + 'fr)';
	}

	function populationOfPair(users: number): PopulationInfo | undefined {
		return populations.find((population) => population.readers === users);
	}

	/**
	 * A history group's range from the shared boundaries, so labels fit every cohort: group 1 is
	 * up to the first boundary, group 4 is above the last. Null ends are open.
	 */
	function historyRange(group: string): { min: number | null; max: number | null } {
		const index = groupNumber(group) - 1;
		return {
			min: index <= 0 ? null : historyBoundaries[index - 1] + 1,
			max: index >= historyBoundaries.length ? null : historyBoundaries[index]
		};
	}

	function historyText(group: string, kind: 'Group' | 'Tick'): string {
		const { min, max } = historyRange(group);
		const key =
			min == null
				? 'history' + kind + 'First'
				: max == null
					? 'history' + kind + 'Last'
					: 'history' + kind;
		return t(COPY + 'accuracy.' + key, {
			min: min?.toLocaleString() ?? '',
			max: max?.toLocaleString() ?? ''
		});
	}

	/** Unread's cells on the separate cohort, used when its main-chart bar comes from there. */
	const cohortGroups = $derived(summary.groups.unread_2000.history_group);

	/**
	 * Hit rate by history length, systems in the main chart's order and each on the same readers
	 * as its bar there. The release has only counts per group, so the whiskers are computed here
	 * with the same Wilson method as the release's.
	 */
	const historyGroups = $derived(
		summary.groups.history_group.map((group) => ({
			group: group.group,
			label: historyText(group.group, 'Group'),
			tick: historyText(group.group, 'Tick'),
			rows: chartRows.map(({ row }) => {
				const cell =
					row.population === 'unread_2000'
						? cohortGroups.find((candidate) => candidate.group === group.group)
						: group.systems[row.system];
				return {
					system: row.system,
					cell,
					interval: cell ? wilsonInterval(cell.hits, cell.users) : null
				};
			})
		}))
	);
	const groupAxisMax = $derived(
		axisFor(
			historyGroups.flatMap((group) =>
				group.rows.flatMap((entry) => (entry.interval ? [entry.interval] : []))
			)
		)
	);

	/*
	 * History chart geometry. The plot is drawn in pixels of its measured width so markers stay
	 * round and the dodge between series stays constant on every screen. Groups are ordered
	 * quartiles, so they sit at equal steps, not on a numeric scale of books.
	 */
	const PLOT_HEIGHT = 240;
	/** Horizontal gap between neighbouring series at one group, so whiskers do not overlap. */
	const DODGE = 12;
	let plotWidth = $state(640);
	let activeGroup = $state<number | null>(null);

	function groupCentre(index: number): number {
		return ((index + 0.5) / Math.max(1, historyGroups.length)) * plotWidth;
	}

	function plotY(share: number): number {
		return (1 - Math.min(share, groupAxisMax) / groupAxisMax) * PLOT_HEIGHT;
	}

	/** One line per system, through the groups it was asked about. */
	const historySeries = $derived(
		chartRows.map(({ row, mark }, seriesIndex) => {
			const offset = (seriesIndex - (chartRows.length - 1) / 2) * DODGE;
			const points = historyGroups.flatMap((group, groupIndex) => {
				const entry = group.rows.find((candidate) => candidate.system === row.system);
				if (!entry?.cell || !entry.interval) return [];
				const x = groupCentre(groupIndex) + offset;
				return [
					{
						x,
						y: plotY(entry.cell.hits / entry.cell.users),
						low: plotY(entry.interval[0]),
						high: plotY(entry.interval[1])
					}
				];
			});
			return { system: row.system, mark, points };
		})
	);

	function readout(entry: (typeof historyGroups)[number]['rows'][number]): string {
		if (!entry.cell || !entry.interval) return t(COPY + 'accuracy.notAsked');
		return (
			t(COPY + 'accuracy.found', {
				hits: entry.cell.hits.toLocaleString(),
				users: entry.cell.users.toLocaleString()
			}) +
			' · ' +
			formatPercent(entry.cell.hits / entry.cell.users) +
			' (' +
			formatInterval(entry.interval) +
			')'
		);
	}

	function groupReadout(group: (typeof historyGroups)[number]): string {
		return (
			group.label +
			': ' +
			group.rows.map((entry) => systemName(entry.system) + ' ' + readout(entry)).join('; ')
		);
	}
</script>

{#snippet systemLabel(system: SystemId)}
	<span class="benchmark-rates__label">
		<span class="benchmark-system-name"
			><i aria-hidden="true" class={'benchmark-key benchmark-key--' + system}></i><span
				>{systemName(system)}</span
			></span
		>
	</span>
{/snippet}

{#snippet partialNotes()}
	{#each chartRows.filter((entry) => entry.mark) as { row, info, mark } (row.system)}
		{#if info}
			<p class="benchmark-note">
				<span aria-hidden="true">{mark} </span>{t(COPY + 'accuracy.partialNote', {
					system: systemName(row.system),
					users: row.users,
					min: info.history_min ?? '',
					max: info.history_max ?? '',
					total: allInfo?.readers ?? ''
				})}
			</p>
		{/if}
	{/each}
{/snippet}

{#snippet marker(system: SystemId, x: number, y: number)}
	{#if system === 'chatgpt'}
		<rect
			class="benchmark-lines__marker"
			x={x - 4.5}
			y={y - 4.5}
			width="9"
			height="9"
			rx="1"
			transform={'rotate(45 ' + x + ' ' + y + ')'}
		/>
	{:else if system === 'hardcover'}
		<rect class="benchmark-lines__marker" x={x - 5} y={y - 5} width="10" height="10" rx="1" />
	{:else}
		<circle class="benchmark-lines__marker" cx={x} cy={y} r="5" />
	{/if}
{/snippet}

{#snippet rateRow(
	system: SystemId,
	hits: number,
	users: number,
	interval: [number, number],
	max: number,
	note: string | null
)}
	{@const readers = t(COPY + 'accuracy.tipReaders', {
		hits: hits.toLocaleString(),
		users: users.toLocaleString()
	})}
	{@const range = t(COPY + 'accuracy.tipInterval', { interval: formatInterval(interval) })}
	<div
		class="benchmark-rates__row"
		class:benchmark-rates__row--active={activeRate === system}
		style={'--system-color: var(--benchmark-' + system + ')'}
	>
		{@render systemLabel(system)}
		<span class="benchmark-rates__track" aria-hidden="true">
			<span class="benchmark-rates__bar" style={'width: ' + position(hits / users, max)}></span>
			<span
				class="benchmark-rates__whisker"
				style={'left: ' +
					position(interval[0], max) +
					'; width: calc(' +
					position(interval[1], max) +
					' - ' +
					position(interval[0], max) +
					')'}
			></span>
			<!--
				Anchored along its own width in step with the bar end, across the whole row (label to
				value), so it stays inside the row even where the track is narrower than the tip.
			-->
			<span
				class="benchmark-rates__tip"
				style={'--tip-at: ' +
					Math.min(hits / users, max) / max +
					'; transform: translateX(-' +
					position(hits / users, max) +
					')'}
			>
				<strong>{formatPercent(hits / users)}</strong>
				<span>{readers}</span>
				<span>{range}</span>
				{#if note}<span class="benchmark-rates__tip-note">{note}</span>{/if}
			</span>
		</span>
		<span class="benchmark-rates__value"><strong>{formatPercent(hits / users)}</strong></span>
		<!-- The whole row opens the details; its label carries them for screen readers. -->
		<button
			type="button"
			class="benchmark-rates__hit"
			aria-label={systemName(system) +
				': ' +
				formatPercent(hits / users) +
				', ' +
				readers +
				', ' +
				range +
				(note ? '. ' + note : '')}
			onpointerenter={(event) => {
				if (event.pointerType === 'mouse') activeRate = system;
			}}
			onpointerleave={(event) => {
				if (event.pointerType === 'mouse') activeRate = null;
			}}
			onfocus={() => (activeRate = system)}
			onblur={() => (activeRate = null)}
			onclick={() => (activeRate = system)}
		></button>
	</div>
{/snippet}

<section class="benchmark-block" aria-labelledby="benchmark-accuracy-heading">
	<h2 class="benchmark-block__heading" id="benchmark-accuracy-heading">
		{t(COPY + 'accuracy.heading')}
	</h2>
	{#if headline}
		<p class="benchmark-note">{headline}</p>
	{/if}

	<figure class="benchmark-rates" aria-label={t(COPY + 'accuracy.chartLabel')}>
		<div class="benchmark-rates__group">
			{#each chartRows as { row, note, interval } (row.system)}
				{@render rateRow(row.system, row.hits, row.users, interval, axisMax, note)}
			{/each}
		</div>
		<div class="benchmark-rates__axis" aria-hidden="true">
			<span></span>
			<span class="benchmark-rates__ticks">
				{#each ticksFor(axisMax) as tick (tick)}
					<span style={'left: ' + position(tick, axisMax)}>{Math.round(tick * 100)}%</span>
				{/each}
			</span>
			<span></span>
		</div>
		<div class="benchmark-rates__axis benchmark-rates__axis-title" aria-hidden="true">
			<span></span>
			<span>{t(COPY + 'accuracy.axis')}</span>
			<span></span>
		</div>
	</figure>
</section>

<section class="benchmark-block" aria-labelledby="benchmark-pairs-heading">
	<h2 class="benchmark-block__heading" id="benchmark-pairs-heading">
		{t(COPY + 'accuracy.pairsHeading')}
	</h2>
	{#if overlap}
		<p class="benchmark-note">{overlap}</p>
	{/if}
	<ul class="benchmark-pairs">
		{#each summary.accuracy.paired as pair (pair.a + pair.b)}
			{@const clear = pair.p_exact < SIGNIFICANCE}
			{@const population = populationOfPair(pair.users)}
			{@const tipId = 'benchmark-pair-p-' + pair.a + '-' + pair.b}
			{@const segments = [
				{ kind: 'a', count: pair.only_a },
				{ kind: 'both', count: pair.both },
				{ kind: 'b', count: pair.only_b }
			]}
			<li
				class="benchmark-pair"
				style={'--a-color: var(--benchmark-' +
					pair.a +
					'); --b-color: var(--benchmark-' +
					pair.b +
					')'}
			>
				<div class="benchmark-pair__title">
					<strong
						>{t(COPY + 'accuracy.pairTitle', {
							a: systemName(pair.a),
							b: systemName(pair.b)
						})}</strong
					>
					<span class="benchmark-pair__verdict">
						<button
							type="button"
							class="benchmark-chip benchmark-pair__chip"
							class:benchmark-chip--strong={clear}
							aria-describedby={tipId}
							>{t(
								COPY + (clear ? 'accuracy.clearDifference' : 'accuracy.noClearDifference')
							)}</button
						>
						<span class="benchmark-pair__tip" role="tooltip" id={tipId}>
							<span
								>{population
									? populationLabel(population)
									: t(COPY + 'accuracy.pairReaders', { count: pair.users })}</span
							>
							<span>{t(COPY + 'accuracy.pValue', { p: formatPValue(pair.p_exact) })}</span>
						</span>
					</span>
				</div>
				<!--
					One bar of the readers at least one of the two found, split into only A, both and
					only B. Each segment is labelled with its share of all the pair's readers, and a
					bracket over "only A + both" and under "both + only B" gives each recommender's total.
				-->
				<div
					class="benchmark-pair__overlap"
					style={'grid-template-columns: ' +
						segments.map(({ count, kind }) => column(count, kind)).join(' ')}
					aria-hidden="true"
				>
					<span class="benchmark-pair__bracket benchmark-pair__bracket--a">
						<span class="benchmark-pair__bracket-label"
							><i class={'benchmark-key benchmark-key--' + pair.a}></i>{systemName(pair.a)}
							<strong>{shareOf(pair.only_a + pair.both, pair.users)}</strong></span
						>
						<span class="benchmark-pair__bracket-line"></span>
					</span>
					{#each segments as segment, index (segment.kind)}
						{#if segment.count > 0}
							<span
								class={'benchmark-pair__segment benchmark-pair__segment--' + segment.kind}
								style={'grid-column: ' + (index + 1)}
								>{#if segment.kind === 'both'}{t(COPY + 'accuracy.bothShare', {
										share: shareOf(segment.count, pair.users)
									})}{:else}{shareOf(segment.count, pair.users)}{/if}</span
							>
						{/if}
					{/each}
					<span class="benchmark-pair__bracket benchmark-pair__bracket--b">
						<span class="benchmark-pair__bracket-line"></span>
						<span class="benchmark-pair__bracket-label"
							><i class={'benchmark-key benchmark-key--' + pair.b}></i>{systemName(pair.b)}
							<strong>{shareOf(pair.only_b + pair.both, pair.users)}</strong></span
						>
					</span>
				</div>
				<p class="benchmark-sr-only">
					{t(COPY + 'accuracy.pairSummary', {
						a: systemName(pair.a),
						b: systemName(pair.b),
						shareA: shareOf(pair.only_a + pair.both, pair.users),
						shareB: shareOf(pair.only_b + pair.both, pair.users),
						shareBoth: shareOf(pair.both, pair.users)
					})}
				</p>
			</li>
		{/each}
	</ul>
</section>

<section class="benchmark-block" aria-labelledby="benchmark-groups-heading">
	<h2 class="benchmark-block__heading" id="benchmark-groups-heading">
		{t(COPY + 'accuracy.groupsHeading')}
	</h2>
	<p class="benchmark-note">{t(COPY + 'accuracy.groupsIntro')}</p>

	<figure class="benchmark-lines" aria-label={t(COPY + 'accuracy.historyChartLabel')}>
		<div class="benchmark-lines__legend" aria-hidden="true">
			{#each historySeries as series (series.system)}
				<span style={'--system-color: var(--benchmark-' + series.system + ')'}
					><svg viewBox="-6 -6 12 12" class="benchmark-lines__key"
						>{@render marker(series.system, 0, 0)}</svg
					><span
						>{systemName(series.system)}{#if series.mark}<sup
								class="benchmark-rates__star"
								aria-hidden="true">{series.mark}</sup
							>{/if}</span
					></span
				>
			{/each}
		</div>
		<span class="benchmark-lines__y-title" aria-hidden="true">{t(COPY + 'accuracy.axis')}</span>
		<div class="benchmark-lines__body">
			<div class="benchmark-lines__y-axis" aria-hidden="true">
				{#each ticksFor(groupAxisMax) as tick (tick)}
					<span style={'top: ' + (plotY(tick) / PLOT_HEIGHT) * 100 + '%'}
						>{Math.round(tick * 100)}%</span
					>
				{/each}
			</div>
			<div
				class="benchmark-lines__plot"
				style={'height: ' + PLOT_HEIGHT + 'px'}
				bind:clientWidth={plotWidth}
			>
				<svg
					class="benchmark-lines__svg"
					width={plotWidth}
					height={PLOT_HEIGHT}
					viewBox={'0 0 ' + plotWidth + ' ' + PLOT_HEIGHT}
					aria-hidden="true"
				>
					{#each ticksFor(groupAxisMax) as tick (tick)}
						<line
							class="benchmark-lines__grid"
							class:benchmark-lines__grid--base={tick === 0}
							x1="0"
							x2={plotWidth}
							y1={plotY(tick)}
							y2={plotY(tick)}
						/>
					{/each}
					{#if activeGroup != null}
						<line
							class="benchmark-lines__crosshair"
							x1={groupCentre(activeGroup)}
							x2={groupCentre(activeGroup)}
							y1="0"
							y2={PLOT_HEIGHT}
						/>
					{/if}
					{#each historySeries as series (series.system)}
						<g style={'--system-color: var(--benchmark-' + series.system + ')'}>
							{#each series.points as point, index (index)}
								<g class="benchmark-lines__whisker">
									<line x1={point.x} x2={point.x} y1={point.high} y2={point.low} />
									<line x1={point.x - 3} x2={point.x + 3} y1={point.high} y2={point.high} />
									<line x1={point.x - 3} x2={point.x + 3} y1={point.low} y2={point.low} />
								</g>
							{/each}
							<polyline
								class="benchmark-lines__line"
								points={series.points.map((point) => point.x + ',' + point.y).join(' ')}
							/>
							{#each series.points as point, index (index)}
								{@render marker(series.system, point.x, point.y)}
							{/each}
						</g>
					{/each}
				</svg>
				{#each historyGroups as group, index (group.group)}
					<button
						type="button"
						class="benchmark-lines__hit"
						style={'left: ' +
							(index / historyGroups.length) * 100 +
							'%; width: ' +
							100 / historyGroups.length +
							'%'}
						aria-label={groupReadout(group)}
						onpointerenter={() => (activeGroup = index)}
						onpointerleave={() => (activeGroup = null)}
						onfocus={() => (activeGroup = index)}
						onblur={() => (activeGroup = null)}
					></button>
				{/each}
				{#if activeGroup != null}
					{@const group = historyGroups[activeGroup]}
					<div
						class="benchmark-lines__tip"
						class:benchmark-lines__tip--start={activeGroup === 0}
						class:benchmark-lines__tip--end={activeGroup === historyGroups.length - 1}
						style={'left: ' + (groupCentre(activeGroup) / plotWidth) * 100 + '%'}
						aria-hidden="true"
					>
						<strong>{group.label}</strong>
						{#each group.rows as entry (entry.system)}
							<span style={'--system-color: var(--benchmark-' + entry.system + ')'}
								><svg viewBox="-6 -6 12 12" class="benchmark-lines__key"
									>{@render marker(entry.system, 0, 0)}</svg
								>{systemName(entry.system)}<em>{readout(entry)}</em></span
							>
						{/each}
					</div>
				{/if}
			</div>
		</div>
		<div class="benchmark-lines__x-axis" aria-hidden="true">
			<span></span>
			<span class="benchmark-lines__x-ticks">
				{#each historyGroups as group, index (group.group)}
					<span style={'left: ' + ((index + 0.5) / historyGroups.length) * 100 + '%'}
						>{group.tick}</span
					>
				{/each}
			</span>
			<span></span>
			<span class="benchmark-lines__x-title">{t(COPY + 'accuracy.historyAxis')}</span>
		</div>
		<!-- Wrapped: a table ignores the 1px sizing of .benchmark-sr-only and would widen the page. -->
		<div class="benchmark-sr-only">
			<table>
				<caption>{t(COPY + 'accuracy.historyChartLabel')}</caption>
				<thead>
					<tr>
						<th scope="col">{t(COPY + 'accuracy.historyAxis')}</th>
						{#each chartRows as { row } (row.system)}
							<th scope="col">{systemName(row.system)}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each historyGroups as group (group.group)}
						<tr>
							<th scope="row">{group.label}</th>
							{#each group.rows as entry (entry.system)}
								<td>{readout(entry)}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<figcaption class="benchmark-rates__caption">
			{@render partialNotes()}
			<p class="benchmark-note">{t(COPY + 'accuracy.historyCiNote')}</p>
		</figcaption>
	</figure>
</section>

<style>
	.benchmark-rates {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-card-bg);
	}
	.benchmark-rates__group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-bottom: var(--space-3);
	}
	.benchmark-rates__label :global(.benchmark-system-name i) {
		flex-shrink: 0;
	}
	.benchmark-rates__axis-title span {
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		text-align: center;
		color: var(--color-text-muted);
	}
	.benchmark-pair__verdict {
		position: relative;
		display: inline-flex;
	}
	.benchmark-pair__chip {
		margin: 0;
		appearance: none;
		line-height: inherit;
		cursor: help;
	}
	.benchmark-pair__chip:not(:global(.benchmark-chip--strong)) {
		background: transparent;
	}
	/* The p-value shows on hover, and on focus for keyboard and touch. */
	.benchmark-pair__tip {
		position: absolute;
		right: 0;
		bottom: calc(100% + 0.375rem);
		z-index: 3;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		width: max-content;
		max-width: min(24rem, 85vw);
		padding: 0.375rem 0.625rem;
		border-radius: var(--radius-xs);
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
		color: var(--color-card-bg);
		background: var(--color-text);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition: opacity 120ms ease;
	}
	.benchmark-pair__verdict:hover .benchmark-pair__tip,
	.benchmark-pair__verdict:focus-within .benchmark-pair__tip {
		opacity: 1;
		visibility: visible;
	}
	.benchmark-rates__star {
		margin-left: 0.0625rem;
		font-size: 0.75em;
		line-height: 0;
		color: var(--color-text-muted);
	}
	.benchmark-rates__caption {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	/* Main chart details: shown above the bar end on hover, focus or tap. */
	.benchmark-rates__row {
		position: relative;
	}
	.benchmark-rates__hit {
		position: absolute;
		inset: -0.25rem 0;
		z-index: 1;
		margin: 0;
		padding: 0;
		border: 0;
		border-radius: var(--radius-xs);
		background: transparent;
		cursor: help;
	}
	.benchmark-rates__hit:focus-visible {
		outline: 2px solid var(--color-text-muted);
		outline-offset: 2px;
	}
	.benchmark-rates__row--active .benchmark-rates__track {
		box-shadow: 0 0 0 1px var(--color-border);
	}
	.benchmark-rates__tip {
		position: absolute;
		bottom: calc(100% + var(--space-2));
		z-index: 3;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		/*
		 * Never wider than the row, so the proportional anchoring keeps it inside it; on a narrow
		 * phone the lines wrap instead of widening the page (a hidden tip still counts toward the
		 * page width). --row-lead and --row-tail are the label and value columns with their gaps.
		 */
		left: calc(var(--tip-at) * (100% + var(--row-lead) + var(--row-tail)) - var(--row-lead));
		width: max-content;
		max-width: calc(100% + var(--row-lead) + var(--row-tail));
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xs);
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		background: var(--color-card-bg);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
		pointer-events: none;
		visibility: hidden;
		opacity: 0;
		transition: opacity 120ms ease;
	}
	.benchmark-rates__tip-note {
		max-width: 15rem;
		margin-top: 0.25rem;
		padding-top: 0.25rem;
		border-top: 1px solid var(--color-border);
		line-height: 1.4;
	}
	.benchmark-rates__tip strong {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
	}
	.benchmark-rates__row--active .benchmark-rates__tip {
		visibility: visible;
		opacity: 1;
	}
	/* History chart: one line per recommender across the history-length groups. */
	.benchmark-lines {
		--lines-y-axis: 2.5rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-card-bg);
	}
	.benchmark-lines__legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
	}
	.benchmark-lines__legend > span {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.benchmark-lines__key {
		flex-shrink: 0;
		width: 0.75rem;
		height: 0.75rem;
		overflow: visible;
	}
	.benchmark-lines__y-title,
	.benchmark-lines__x-title,
	.benchmark-lines__y-axis span,
	.benchmark-lines__x-ticks span {
		font-family: var(--font-family-interactive);
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}
	.benchmark-lines__y-title {
		margin-top: var(--space-2);
		font-size: 0.75rem;
	}
	.benchmark-lines__body,
	.benchmark-lines__x-axis {
		display: grid;
		grid-template-columns: var(--lines-y-axis) minmax(0, 1fr);
	}
	.benchmark-lines__y-axis {
		position: relative;
	}
	.benchmark-lines__y-axis span {
		position: absolute;
		right: var(--space-2);
		transform: translateY(-50%);
	}
	.benchmark-lines__plot {
		position: relative;
		min-width: 0;
	}
	.benchmark-lines__svg {
		position: absolute;
		inset: 0;
		overflow: visible;
	}
	.benchmark-lines__grid {
		stroke: color-mix(in srgb, var(--color-viz-track) 60%, transparent);
		stroke-width: 1;
	}
	.benchmark-lines__grid--base {
		stroke: var(--color-viz-baseline);
	}
	.benchmark-lines__crosshair {
		stroke: var(--color-text-muted);
		stroke-width: 1;
	}
	.benchmark-lines__line {
		fill: none;
		stroke: var(--system-color);
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.benchmark-lines__whisker line {
		stroke: var(--system-color);
		stroke-width: 1.5;
		stroke-linecap: round;
		opacity: 0.55;
	}
	/* A 2px ring in the card colour keeps each marker legible where it crosses a line. */
	.benchmark-lines__marker {
		fill: var(--system-color);
		stroke: var(--color-card-bg);
		stroke-width: 2;
		paint-order: stroke;
	}
	.benchmark-lines__hit {
		position: absolute;
		top: 0;
		bottom: 0;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: crosshair;
	}
	.benchmark-lines__hit:focus-visible {
		outline: 2px solid var(--color-text-muted);
		outline-offset: -2px;
	}
	.benchmark-lines__tip {
		position: absolute;
		/* Inside the top of the plot, above the highest points; only whisker tips sit there. */
		top: var(--space-1);
		z-index: 3;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 13rem;
		padding: var(--space-2) var(--space-3);
		transform: translateX(-50%);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xs);
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		color: var(--color-text);
		background: var(--color-card-bg);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
		pointer-events: none;
	}
	.benchmark-lines__tip--start {
		transform: translateX(-15%);
	}
	.benchmark-lines__tip--end {
		transform: translateX(-85%);
	}
	.benchmark-lines__tip span {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		white-space: nowrap;
	}
	.benchmark-lines__tip em {
		margin-left: auto;
		padding-left: var(--space-3);
		font-style: normal;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}
	.benchmark-lines__x-axis {
		row-gap: var(--space-1);
	}
	.benchmark-lines__x-ticks {
		position: relative;
		height: 1.25rem;
		margin-top: var(--space-2);
	}
	.benchmark-lines__x-ticks span {
		position: absolute;
		transform: translateX(-50%);
		white-space: nowrap;
	}
	.benchmark-lines__x-title {
		grid-column: 2;
		text-align: center;
		font-size: 0.75rem;
	}
	.benchmark-rates__row,
	.benchmark-rates__axis {
		--row-lead: calc(7rem + var(--space-3));
		--row-tail: calc(3.5rem + var(--space-3));
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr) 3.5rem;
		gap: var(--space-3);
		align-items: center;
	}
	.benchmark-rates__label {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.benchmark-rates__label,
	.benchmark-rates__value {
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
	}
	.benchmark-rates__value {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.benchmark-rates__track {
		position: relative;
		height: 1.25rem;
		border-radius: var(--radius-xs);
		background: color-mix(in srgb, var(--color-viz-track) 35%, transparent);
	}
	.benchmark-rates__bar {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: var(--radius-xs);
		background: var(--system-color);
	}
	.benchmark-rates__whisker {
		position: absolute;
		top: 50%;
		height: 0.625rem;
		transform: translateY(-50%);
		border: 2px solid var(--color-text);
		border-top: 0;
		border-bottom: 0;
		background: linear-gradient(var(--color-text), var(--color-text)) center / 100% 2px no-repeat;
		opacity: 0.7;
	}
	.benchmark-rates__ticks {
		position: relative;
		height: 1rem;
		border-top: 1px solid var(--color-viz-baseline);
	}
	.benchmark-rates__ticks span {
		position: absolute;
		top: 0.2rem;
		transform: translateX(-50%);
		font-family: var(--font-family-interactive);
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.benchmark-pairs {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	/*
	 * Each card shares its rows (title, overlap bar) with the cards beside it, so the bars line up
	 * even when one card's title row wraps.
	 */
	.benchmark-pair {
		position: relative;
		display: grid;
		grid-row: span 2;
		grid-template-rows: subgrid;
		row-gap: var(--space-3);
		align-content: start;
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-card-bg);
	}
	.benchmark-pair__title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		font-family: var(--font-family-interactive);
		font-size: 0.875rem;
		color: var(--color-text);
	}
	.benchmark-pair__overlap {
		display: grid;
		grid-template-rows: auto 1.75rem auto;
		column-gap: 2px;
		row-gap: 0.25rem;
	}
	.benchmark-pair__segment {
		grid-row: 2;
		display: grid;
		place-items: center;
		min-width: 0;
		border-radius: var(--radius-xs);
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-bg);
	}
	.benchmark-pair__segment--a {
		background: var(--a-color);
	}
	.benchmark-pair__segment--b {
		background: var(--b-color);
	}
	.benchmark-pair__segment--both {
		color: var(--color-text);
		background: color-mix(in srgb, var(--color-viz-neutral) 45%, transparent);
	}
	/* A over "only A + both" (columns 1–2), B under "both + only B" (columns 2–3). */
	.benchmark-pair__bracket {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.benchmark-pair__bracket--a {
		grid-row: 1;
		grid-column: 1 / 3;
		--bracket-color: var(--a-color);
		--system-color: var(--a-color);
	}
	.benchmark-pair__bracket--b {
		grid-row: 3;
		grid-column: 2 / 4;
		align-items: flex-end;
		--bracket-color: var(--b-color);
		--system-color: var(--b-color);
	}
	.benchmark-pair__bracket-line {
		align-self: stretch;
		height: 0.375rem;
		border: 2px solid var(--bracket-color);
	}
	.benchmark-pair__bracket--a .benchmark-pair__bracket-line {
		border-bottom: 0;
		border-radius: 3px 3px 0 0;
	}
	.benchmark-pair__bracket--b .benchmark-pair__bracket-line {
		border-top: 0;
		border-radius: 0 0 3px 3px;
	}
	.benchmark-pair__bracket-label {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		white-space: nowrap;
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.benchmark-pair__bracket-label strong {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}

	@media (max-width: 480px) {
		.benchmark-rates__row,
		.benchmark-rates__axis {
			--row-lead: calc(6.25rem + var(--space-2));
			--row-tail: calc(3.25rem + var(--space-2));
			grid-template-columns: 6.25rem minmax(0, 1fr) 3.25rem;
			gap: var(--space-2);
		}
		/* The axis title spans the whole row so it does not wrap under the narrow track. */
		.benchmark-rates__axis-title span:empty {
			display: none;
		}
		.benchmark-rates__axis-title span {
			grid-column: 1 / -1;
		}
		/* No room beside the rate on narrow screens: the count goes under it. */
		/* Every other tick on narrow screens so the labels do not collide. */
		.benchmark-rates__ticks span:nth-child(even) {
			display: none;
		}
	}
</style>
