<script lang="ts">
	import { onDestroy } from 'svelte';
	import TagFilterPicker from './TagFilterPicker.svelte';
	import DimensionChoices from './DimensionChoices.svelte';
	import FilterTagPicker from './FilterTagPicker.svelte';
	import PresetBounds from './PresetBounds.svelte';
	import StartingBookPicker from './StartingBookPicker.svelte';
	import RelativeDimensionChoices from './RelativeDimensionChoices.svelte';
	import {
		FILTER_DIMENSIONS,
		YEAR_PRESETS,
		PAGE_PRESETS,
		POPULARITY_PRESETS,
		RATING_PRESETS,
		isStartingBookId,
		describeTagSelection,
		type FilterDraft
	} from '$lib/recommendations/filteredRecommendations';
	import { loadAuthorOptions, searchAuthorOptions } from '$lib/recommendations/authorOptions';
	import type { StartingBook } from '$lib/recommendations/startingBooks';
	import filterOptions from '$lib/recommendations/filter-options.generated.json';
	let {
		draft = $bindable(),
		resolvedBook = null,
		onSeedResolve,
		onSeedAvailabilityChange,
		activeTag,
		onTagOpen,
		onTagClose
	}: {
		draft: FilterDraft;
		resolvedBook?: StartingBook | null;
		onSeedResolve: (book: StartingBook) => void;
		onSeedAvailabilityChange: (bookId: string, available: boolean) => void;
		activeTag: 'genres' | 'keywords' | null;
		onTagOpen: (tag: 'genres' | 'keywords') => void;
		onTagClose: () => void;
	} = $props();
	let authorSuggestions = $state<string[]>([]),
		authorLoading = $state(false),
		authorError = $state('');
	let authorGeneration = 0;
	let sourceBook = $state<StartingBook | null>(null);
	const sourceId = $derived(draft.seedBookId);
	let taxonomyOpen = $derived(!sourceId);
	const currentSource = $derived(
		sourceBook?.book_id === draft.seedBookId
			? sourceBook
			: resolvedBook?.book_id === draft.seedBookId
				? resolvedBook
				: null
	);
	const RELATIVE_FEATURED = new Set(['violence', 'pace']);
	const taxonomySummary = $derived(
		[
			...draft.types,
			...describeTagSelection(draft.genres),
			...describeTagSelection(draft.keywords)
		].join(' · ') || 'Any type, genre, theme or trope'
	);
	const FEATURED_GENRES = [
		'Fantasy',
		'Romance',
		'Mystery',
		'Science Fiction',
		'Thriller',
		'Biography',
		'History',
		'Psychology'
	];
	const FEATURED_KEYWORDS = [
		'Enemies to Lovers',
		'Dark Academia',
		'Chosen One',
		'Heist',
		'First Contact',
		'Detective',
		'Climate Change',
		'Grief'
	];
	const FEATURED_DIMENSIONS = new Set(['spice', 'violence', 'pace', 'atmosphere']);

	const advancedCount = $derived(
		[draft.year, draft.pages, draft.popularity, draft.averageRating].filter(
			(range) => range.min.trim() || range.max.trim()
		).length +
			draft.authors.length +
			FILTER_DIMENSIONS.filter((dimension) => draft.dimensions[dimension.key].enabled).length
	);
	const readingFeelCount = $derived(
		FILTER_DIMENSIONS.filter((dimension) => draft.dimensions[dimension.key].enabled).length
	);
	const moreReadingCount = $derived(
		FILTER_DIMENSIONS.filter(
			(dimension) =>
				!FEATURED_DIMENSIONS.has(dimension.key) && draft.dimensions[dimension.key].enabled
		).length
	);

	function chooseStartingBook(book: StartingBook | null) {
		if (draft.seedBookId !== (book?.book_id ?? '')) draft.relativeDimensions = {};
		draft.seedBookId = book?.book_id ?? '';
	}

	function changeRelativeDimension(
		key: (typeof FILTER_DIMENSIONS)[number]['key'],
		value: number | undefined
	) {
		if (value === undefined) delete draft.relativeDimensions[key];
		else draft.relativeDimensions[key] = value;
	}

	async function searchAuthors(query: string) {
		const generation = ++authorGeneration;
		authorSuggestions = [];
		authorError = '';
		if (query.trim().length < 2) {
			authorLoading = false;
			return;
		}
		authorLoading = true;
		try {
			const options = await loadAuthorOptions();
			if (generation === authorGeneration) {
				authorSuggestions = searchAuthorOptions(options, query);
			}
		} catch {
			if (generation === authorGeneration) authorError = 'Author search is unavailable. Try again.';
		} finally {
			if (generation === authorGeneration) authorLoading = false;
		}
	}

	onDestroy(() => {
		authorGeneration += 1;
	});
</script>

<div class="filter-fields">
	<StartingBookPicker
		bookId={draft.seedBookId}
		resolvedBook={currentSource}
		onChange={chooseStartingBook}
		onAvailabilityChange={onSeedAvailabilityChange}
		onResolve={(book) => {
			sourceBook = book;
			onSeedResolve(book);
		}}
	/>
	{#if draft.seedBookId && isStartingBookId(draft.seedBookId)}
		<details class="filter-fields__dimensions" open>
			<summary>What would you change?</summary>
			{#each FILTER_DIMENSIONS.filter( (dimension) => RELATIVE_FEATURED.has(dimension.key) ) as dimension (dimension.key)}
				<RelativeDimensionChoices
					{dimension}
					value={draft.relativeDimensions[dimension.key]}
					onChange={(next) => changeRelativeDimension(dimension.key, next)}
				/>
			{/each}
			<details
				class="filter-fields__all-dimensions"
				open={FILTER_DIMENSIONS.some(
					(dimension) =>
						!RELATIVE_FEATURED.has(dimension.key) &&
						draft.relativeDimensions[dimension.key] !== undefined
				)}
			>
				<summary>More attributes to adjust</summary>
				{#each FILTER_DIMENSIONS.filter((dimension) => !RELATIVE_FEATURED.has(dimension.key)) as dimension (dimension.key)}
					<RelativeDimensionChoices
						{dimension}
						value={draft.relativeDimensions[dimension.key]}
						onChange={(next) => changeRelativeDimension(dimension.key, next)}
					/>
				{/each}
			</details>
		</details>
	{/if}
	<details class="filter-fields__group" bind:open={taxonomyOpen}>
		<summary><span>Genres, themes &amp; tropes</span><small>{taxonomySummary}</small></summary>
		<div class="filter-fields__group-body">
			<fieldset class="filter-fields__types">
				<legend class="recommendation-filter-label">Book type</legend>
				<div class="filter-fields__type-options">
					{#each [{ label: 'Any', value: '' }, { label: 'Fiction', value: 'Fiction' }, { label: 'Nonfiction', value: 'Nonfiction' }] as option (option.label)}
						<label
							class="recommendation-filter-choice"
							class:active={draft.types.length !== 1
								? option.value === ''
								: draft.types[0] === option.value}
						>
							<input
								type="radio"
								name="filter-book-type"
								value={option.value}
								checked={draft.types.length !== 1
									? option.value === ''
									: draft.types[0] === option.value}
								onchange={() =>
									(draft.types = option.value ? [option.value as 'Fiction' | 'Nonfiction'] : [])}
							/>
							{option.label}
						</label>
					{/each}
				</div>
			</fieldset>
			<TagFilterPicker
				id="filter-genres"
				label="Genres"
				open={activeTag === 'genres'}
				onOpen={() => onTagOpen('genres')}
				onClose={onTagClose}
				options={filterOptions.genres}
				featured={FEATURED_GENRES}
				value={draft.genres}
				sourceTags={currentSource?.genres ?? []}
				hasSource={!!draft.seedBookId}
				onChange={(next) => (draft.genres = next)}
			/>
			<TagFilterPicker
				id="filter-keywords"
				label="Themes & tropes"
				open={activeTag === 'keywords'}
				onOpen={() => onTagOpen('keywords')}
				onClose={onTagClose}
				options={filterOptions.keywords}
				featured={FEATURED_KEYWORDS}
				value={draft.keywords}
				sourceTags={currentSource?.keywords ?? []}
				hasSource={!!draft.seedBookId}
				onChange={(next) => (draft.keywords = next)}
			/>
			<p class="filter-fields__matching-note">All filters apply together.</p>
		</div>
	</details>
	<details class="filter-fields__advanced">
		<summary>More preferences{advancedCount ? ` (${advancedCount} active)` : ''}</summary>
		<p>Filters exclude books with missing information for the selected attribute.</p>
		<FilterTagPicker
			id="filter-authors"
			label="Authors"
			options={authorSuggestions}
			selected={draft.authors}
			onChange={(next) => (draft.authors = next)}
			minimumQueryLength={2}
			onQueryChange={searchAuthors}
			loading={authorLoading}
			error={authorError}
			preFiltered
		/>

		<div class="filter-fields__range-grid">
			<PresetBounds
				id="filter-year"
				label="Publication year"
				value={draft.year}
				presets={YEAR_PRESETS}
				onChange={(next) => (draft.year = next)}
			/>
			<PresetBounds
				id="filter-pages"
				label="Page count"
				value={draft.pages}
				presets={PAGE_PRESETS}
				onChange={(next) => (draft.pages = next)}
			/>
			<PresetBounds
				id="filter-popularity"
				label="Popularity"
				customHint="Popularity percentile (0–100). Higher means more popular."
				value={draft.popularity}
				presets={POPULARITY_PRESETS}
				maximum={100}
				onChange={(next) => (draft.popularity = next)}
			/>
			<PresetBounds
				id="filter-rating"
				label="Reader rating"
				customHint="Reader rating percentile (0–100), not stars. Higher means higher rated."
				value={draft.averageRating}
				presets={RATING_PRESETS}
				maximum={100}
				onChange={(next) => (draft.averageRating = next)}
			/>
		</div>
		<details class="filter-fields__dimensions">
			<summary
				>Book characteristics{readingFeelCount ? ` (${readingFeelCount} active)` : ''}</summary
			>
			{#each FILTER_DIMENSIONS.filter( (dimension) => FEATURED_DIMENSIONS.has(dimension.key) ) as dimension (dimension.key)}
				<DimensionChoices
					{dimension}
					value={draft.dimensions[dimension.key]}
					onChange={(next) => (draft.dimensions[dimension.key] = next)}
				/>
			{/each}
			<details class="filter-fields__all-dimensions">
				<summary
					>More book characteristics{moreReadingCount
						? ` (${moreReadingCount} active)`
						: ''}</summary
				>
				{#each FILTER_DIMENSIONS.filter((dimension) => !FEATURED_DIMENSIONS.has(dimension.key)) as dimension (dimension.key)}
					<DimensionChoices
						{dimension}
						value={draft.dimensions[dimension.key]}
						onChange={(next) => (draft.dimensions[dimension.key] = next)}
					/>
				{/each}
			</details>
		</details>
	</details>
</div>

<style>
	.filter-fields {
		display: grid;
		gap: var(--space-5);
		min-width: 0;
	}
	.filter-fields :global(fieldset) {
		min-width: 0;
	}

	.filter-fields__group,
	.filter-fields__advanced,
	.filter-fields__dimensions,
	.filter-fields__all-dimensions {
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-3);
		min-width: 0;
	}
	summary {
		cursor: pointer;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	summary small {
		display: block;
		margin-top: var(--space-1);
		font-weight: 400;
		font-size: var(--typ-caption-font-size);
		color: var(--color-text-muted);
	}
	.filter-fields__group-body {
		display: grid;
		gap: var(--space-5);
		padding-top: var(--space-4);
	}
	.filter-fields__advanced p,
	.filter-fields__matching-note {
		color: var(--color-text-muted);
		font-size: var(--typ-caption-font-size);
	}
	.filter-fields__types {
		border: 0;
		padding: 0;
		margin: 0;
	}
	.filter-fields__types legend {
		margin-bottom: var(--space-2);
	}
	.filter-fields__type-options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		padding: var(--space-1);
	}
	.filter-fields__type-options label {
		position: relative;
		display: grid;
		place-items: center;
	}

	.filter-fields__type-options input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.filter-fields__range-grid {
		display: grid;
		gap: var(--space-5);
		margin: var(--space-5) 0;
	}
	.filter-fields__all-dimensions {
		margin-top: var(--space-4);
	}
</style>
