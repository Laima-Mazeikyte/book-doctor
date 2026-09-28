<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardGridSkeleton from '$lib/components/BookCardGridSkeleton.svelte';
	import BrowseTagPicker from '$lib/components/recommendations/BrowseTagPicker.svelte';
	import DimensionChoices from '$lib/components/recommendations/DimensionChoices.svelte';
	import FilterTagPicker from '$lib/components/recommendations/FilterTagPicker.svelte';
	import PresetBounds from '$lib/components/recommendations/PresetBounds.svelte';
	import {
		coverPriorityFor,
		estimateGridColumns,
		trackGridColumns
	} from '$lib/components/book-card/coverPriority';
	import {
		buildCleanLikedAuthorSet,
		filterAuthorRelationshipAuthors
	} from '$lib/recommendations/authorRelationships';
	import {
		fetchRecommendations,
		type FetchRecommendationsResult
	} from '$lib/recommendations/fetchRecommendations';
	import {
		buildRecommendationFilters,
		describeFilters,
		draftFromFilters,
		emptyFilterDraft,
		FILTER_DIMENSIONS,
		isFilteredRequest,
		type FilterDraft
	} from '$lib/recommendations/filteredRecommendations';
	import filterOptions from '$lib/recommendations/filter-options.generated.json';
	import { filterRatedLikedBookPrecedents } from '$lib/recommendations/likedBookPrecedents';
	import { loadAuthorOptions, searchAuthorOptions } from '$lib/recommendations/authorOptions';
	import { getSupabase } from '$lib/supabase';
	import { authInitStore, authStore } from '$lib/stores/auth';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import { refreshRecommendationsCountFromApi } from '$lib/stores/recommendationsCount';
	import type { Book, RatingValue } from '$lib/types/book';

	type RequestStatus = 'pending' | 'processing' | 'completed' | 'failed' | null;
	type RequestRow = {
		id: string | number;
		filters: unknown;
		status: RequestStatus;
		result_count: number | null;
		error_code: string | null;
		created_at: string | null;
		processing_started_at: string | null;
	};
	type ViewState =
		| 'idle'
		| 'loading'
		| 'slow'
		| 'paused'
		| 'ready'
		| 'empty'
		| 'failed'
		| 'legacy'
		| 'unavailable'
		| 'error';

	const MIN_RATINGS = 10;
	const POLL_MS = 2000;
	const SLOW_AFTER_MS = 30_000;
	const PAUSE_AFTER_MS = 120_000;
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
	const YEAR_PRESETS = [
		{ label: 'Any year' },
		{ label: 'Since 2020', min: '2020' },
		{ label: 'Since 2000', min: '2000' },
		{ label: 'Before 2000', max: '1999' }
	];
	const PAGE_PRESETS = [
		{ label: 'Any length' },
		{ label: 'Under 300 pages', max: '299' },
		{ label: '300–500 pages', min: '300', max: '500' },
		{ label: 'Over 500 pages', min: '501' }
	];
	const POPULARITY_PRESETS = [
		{ label: 'Any popularity' },
		{ label: 'More popular', min: '70' },
		{ label: 'Less mainstream', max: '30' }
	];
	const RATING_PRESETS = [
		{ label: 'Any rating' },
		{ label: 'Higher rated', min: '80' },
		{ label: 'Highest rated', min: '90' }
	];

	let draft = $state<FilterDraft>(emptyFilterDraft());
	let submittedFilters = $state<unknown>(null);
	let request = $state<RequestRow | null>(null);
	let recent = $state<RequestRow[]>([]);
	let result = $state<FetchRecommendationsResult | null>(null);
	let viewState = $state<ViewState>('idle');
	let message = $state('');
	let formError = $state('');
	let submitting = $state(false);
	let authorSuggestions = $state<string[]>([]);
	let authorLoading = $state(false);
	let authorError = $state('');
	let formVersion = $state(0);
	let gridColumns = $state(estimateGridColumns());
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let authorGeneration = 0;
	let loadGeneration = 0;
	let activeKey = '';
	let waitStartedAt = 0;

	const ratingsSyncMeta = ratingsStore.syncMeta;
	const ratedBooksStore = ratingsStore.ratedBooks;
	const canSubmit = $derived(
		$ratingsStore.size >= MIN_RATINGS &&
			$ratingsSyncMeta.queuedCount === 0 &&
			!$ratingsSyncMeta.isFlushing &&
			!!$authStore.user
	);
	const cleanLikedAuthors = $derived(buildCleanLikedAuthorSet($ratedBooksStore));
	const requestId = $derived(request ? String(request.id) : null);
	const requestIsRunning = $derived(viewState === 'loading' || viewState === 'slow');
	const advancedCount = $derived(
		[draft.year, draft.pages, draft.popularity, draft.averageRating].filter(
			(range) => range.min.trim() || range.max.trim()
		).length +
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

	function clearPoll() {
		if (pollTimer !== null) clearTimeout(pollTimer);
		pollTimer = null;
	}

	function isCurrent(generation: number, id: string, userId: string): boolean {
		return (
			generation === loadGeneration &&
			get(authStore).user?.id === userId &&
			page.url.searchParams.get('request_id') === id
		);
	}

	async function loadRecent(userId: string, generation: number) {
		const supabase = getSupabase();
		if (!supabase) return;
		const { data, error } = await supabase
			.from('recommendation_requests')
			.select('id, filters, status, result_count, error_code, created_at, processing_started_at')
			.eq('user_id', userId)
			.not('filters', 'is', null)
			.order('created_at', { ascending: false })
			.limit(40);
		if (generation !== loadGeneration || get(authStore).user?.id !== userId) return;
		if (error) return;
		recent = (data ?? [])
			.filter((row) => isFilteredRequest(row.filters))
			.slice(0, 12)
			.map((row) =>
				request && String(row.id) === String(request.id) ? request : row
			) as RequestRow[];
	}

	async function fetchRunBooks(id: string, userId: string, generation: number) {
		const token = get(authStore).session?.access_token ?? null;
		if (!token) throw new Error('Sign in to load this recommendation run.');
		const payload = await fetchRecommendations(token, id, { includeRated: true });
		if (!isCurrent(generation, id, userId)) return;
		result = payload;
		viewState = payload.books.length ? 'ready' : 'empty';
		void refreshRecommendationsCountFromApi(token);
	}

	async function readRequest(id: string, userId: string, generation: number, firstRead = false) {
		const supabase = getSupabase();
		if (!supabase || !isCurrent(generation, id, userId)) return;
		const { data, error } = await supabase
			.from('recommendation_requests')
			.select('id, filters, status, result_count, error_code, created_at, processing_started_at')
			.eq('id', id)
			.eq('user_id', userId)
			.maybeSingle();
		if (!isCurrent(generation, id, userId)) return;
		if (error) {
			message = 'Could not check this request. We will try again.';
			if (Date.now() - waitStartedAt < PAUSE_AFTER_MS) {
				pollTimer = setTimeout(() => void readRequest(id, userId, generation), 5000);
			} else {
				viewState = 'paused';
			}
			return;
		}
		if (!data) {
			viewState = 'unavailable';
			message = 'This request is unavailable.';
			return;
		}
		const row = data as RequestRow;
		request = row;
		recent = recent.map((item) => (String(item.id) === id ? row : item));
		submittedFilters = row.filters;
		if (firstRead) {
			draft = draftFromFilters(row.filters);
			formVersion += 1;
			const createdAt = row.created_at ? Date.parse(row.created_at) : NaN;
			if (Number.isFinite(createdAt)) waitStartedAt = Math.min(waitStartedAt, createdAt);
		}
		message = '';
		if (row.status === 'completed') {
			clearPoll();
			if (row.result_count === 0) {
				result = null;
				viewState = 'empty';
			} else {
				try {
					await fetchRunBooks(id, userId, generation);
				} catch {
					if (isCurrent(generation, id, userId)) {
						viewState = 'error';
						message = 'The recommendations are ready, but the books could not be loaded.';
					}
				}
			}
			return;
		}
		if (row.status === 'failed') {
			clearPoll();
			viewState = 'failed';
			message =
				row.error_code === 'invalid_filters'
					? 'These filters could not be used. Edit them and try a new search.'
					: 'We could not finish this request. You can try a new search.';
			return;
		}
		if (row.status === null) {
			clearPoll();
			try {
				await fetchRunBooks(id, userId, generation);
				if (isCurrent(generation, id, userId) && viewState === 'empty') {
					viewState = 'legacy';
					message = 'This older request has no recorded outcome.';
				}
			} catch {
				if (isCurrent(generation, id, userId)) {
					viewState = 'legacy';
					message = 'This older request has no recorded outcome.';
				}
			}
			return;
		}
		const elapsed = Date.now() - waitStartedAt;
		if (elapsed >= PAUSE_AFTER_MS) {
			viewState = 'paused';
			return;
		}
		viewState = elapsed >= SLOW_AFTER_MS ? 'slow' : 'loading';
		pollTimer = setTimeout(
			() => void readRequest(id, userId, generation),
			elapsed >= SLOW_AFTER_MS ? 8000 : POLL_MS
		);
	}

	function checkAgain() {
		const userId = get(authStore).user?.id;
		const id = page.url.searchParams.get('request_id');
		if (!userId || !id) return;
		clearPoll();
		waitStartedAt = Date.now();
		viewState = 'loading';
		void readRequest(id, userId, loadGeneration);
	}

	async function submit() {
		if (submitting || requestIsRunning || !canSubmit) return;
		formError = '';
		let filters;
		try {
			filters = buildRecommendationFilters(draft);
			if (!isFilteredRequest(filters)) throw new Error('Choose at least one filter.');
		} catch (error) {
			formError = error instanceof Error ? error.message : 'Check your filters.';
			return;
		}
		const userId = get(authStore).user?.id;
		const supabase = getSupabase();
		if (!userId || !supabase) return;
		submitting = true;
		let createdId: string | null = null;
		try {
			await notInterestedStore.flushPending();
			if (get(authStore).user?.id !== userId) return;
			const { data, error } = await supabase
				.from('recommendation_requests')
				.insert({ user_id: userId, filters })
				.select('id')
				.single();
			if (error || data?.id == null) throw error ?? new Error('No request ID was returned.');
			createdId = String(data.id);
		} catch {
			formError = 'Could not start this search. Please try again.';
		} finally {
			if (createdId) {
				const destination = resolve(
					`/rate/recommendations/filtered?request_id=${encodeURIComponent(createdId)}`
				);
				try {
					await goto(destination);
				} catch {
					window.location.assign(destination);
				}
			}
			submitting = false;
		}
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

	function handleNotInterested(book: Book) {
		const dismissed = notInterestedStore.toggle(book.book_id);
		if (dismissed) {
			if (planToReadStore.has(book.id)) planToReadStore.toggle(book.id, book.book_id);
			if (get(ratingsStore).has(book.id)) ratingsStore.removeRating(book.id, book.book_id);
		}
	}

	function handleBookmark(book: Book) {
		const alreadyBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(book.id, book.book_id);
		if (!alreadyBookmarked) notInterestedStore.remove(book.book_id);
	}

	function handleRate(book: Book, value: RatingValue) {
		ratingsStore.setRating(book.id, value, book.book_id, book);
	}

	$effect(() => {
		if (!browser) return;
		const authStatus = $authInitStore.status;
		const userId = $authStore.user?.id ?? null;
		const id = page.url.searchParams.get('request_id');
		if (authStatus === 'idle' || authStatus === 'checking') return;
		const key = `${userId ?? ''}:${id ?? ''}`;
		if (key === activeKey) return;
		activeKey = key;
		const generation = ++loadGeneration;
		authorGeneration += 1;
		authorSuggestions = [];
		authorLoading = false;
		authorError = '';
		clearPoll();
		request = null;
		result = null;
		submittedFilters = null;
		message = '';
		formError = '';
		if (!userId) {
			viewState = 'idle';
			recent = [];
			draft = emptyFilterDraft();
			formVersion += 1;
			return;
		}
		void loadRecent(userId, generation);
		if (!id) {
			viewState = 'idle';
			draft = emptyFilterDraft();
			formVersion += 1;
			return;
		}
		if (!/^\d+$/.test(id)) {
			viewState = 'unavailable';
			draft = emptyFilterDraft();
			formVersion += 1;
			return;
		}
		viewState = 'loading';
		waitStartedAt = Date.now();
		void readRequest(id, userId, generation, true);
	});

	onDestroy(() => {
		loadGeneration += 1;
		authorGeneration += 1;
		clearPoll();
	});
</script>

<svelte:head>
	<title>Filtered recommendations — Unread</title>
	<meta
		name="description"
		content="Find personalized book recommendations that match your filters."
	/>
</svelte:head>

<div class="filtered-page">
	<header class="filtered-page__header">
		<h1 class="typ-display2 typ-display2--content">Find your next book</h1>
		<p>Choose what you want to read. Your ratings still shape which matching books appear first.</p>
		<nav aria-label="Recommendation views" class="filtered-page__tabs">
			<a href={resolve('/rate/recommendations')}>For you</a>
			<a href={resolve('/rate/recommendations/filtered')} aria-current="page">Filter books</a>
		</nav>
	</header>

	<div class="filtered-page__layout">
		<aside class="filtered-page__filters">
			<form
				id="filtered-recommendations-form"
				onsubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				{#key formVersion}
					<h2 class="typ-h3">Choose filters</h2>
					<fieldset class="filtered-page__types">
						<legend>Book type</legend>
						<div class="filtered-page__type-options">
							{#each [{ label: 'Any', value: '' }, { label: 'Fiction', value: 'Fiction' }, { label: 'Nonfiction', value: 'Nonfiction' }] as option (option.label)}
								<label
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
											(draft.types = option.value
												? [option.value as 'Fiction' | 'Nonfiction']
												: [])}
									/>
									{option.label}
								</label>
							{/each}
						</div>
					</fieldset>
					<BrowseTagPicker
						id="filter-genres"
						label="Genres"
						options={filterOptions.genres}
						featured={FEATURED_GENRES}
						selected={draft.genres}
						onChange={(next) => (draft.genres = next)}
						mode={draft.genreMode}
						onModeChange={(next) => (draft.genreMode = next)}
					/>
					<BrowseTagPicker
						id="filter-keywords"
						label="Themes"
						options={filterOptions.keywords}
						featured={FEATURED_KEYWORDS}
						selected={draft.keywords}
						onChange={(next) => (draft.keywords = next)}
						mode={draft.keywordMode}
						onModeChange={(next) => (draft.keywordMode = next)}
					/>
					<p class="filtered-page__matching-note">Books must match your choices in each section.</p>
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

					<details class="filtered-page__advanced">
						<summary>Advanced filters{advancedCount ? ` (${advancedCount} active)` : ''}</summary>
						<p>
							No preference leaves an attribute unfiltered. Active filters include only books with
							information for that attribute.
						</p>
						<div class="filtered-page__range-grid">
							<PresetBounds
								id="filter-year"
								label="Publication year"
								hint="Choose a time period or enter your own range."
								value={draft.year}
								presets={YEAR_PRESETS}
								onChange={(next) => (draft.year = next)}
							/>
							<PresetBounds
								id="filter-pages"
								label="Page count"
								hint="Book length in pages."
								value={draft.pages}
								presets={PAGE_PRESETS}
								onChange={(next) => (draft.pages = next)}
							/>
							<PresetBounds
								id="filter-popularity"
								label="Popularity"
								hint="More popular is the 70th percentile and above; less mainstream is 30th and below."
								value={draft.popularity}
								presets={POPULARITY_PRESETS}
								maximum={100}
								onChange={(next) => (draft.popularity = next)}
							/>
							<PresetBounds
								id="filter-rating"
								label="Reader rating"
								hint="80th or 90th percentile and above, not a star cutoff. This does not sort results."
								value={draft.averageRating}
								presets={RATING_PRESETS}
								maximum={100}
								onChange={(next) => (draft.averageRating = next)}
							/>
						</div>
						<details class="filtered-page__dimensions">
							<summary
								>Reading feel{readingFeelCount ? ` (${readingFeelCount} active)` : ''}</summary
							>
							<p>
								Choose a direction for any attribute that matters to you. The ends describe
								different kinds of books, not better or worse books. Choices use broad parts of the
								0–1 scale.
							</p>
							{#each FILTER_DIMENSIONS.filter( (dimension) => FEATURED_DIMENSIONS.has(dimension.key) ) as dimension (dimension.key)}
								<DimensionChoices
									{dimension}
									value={draft.dimensions[dimension.key]}
									onChange={(next) => (draft.dimensions[dimension.key] = next)}
								/>
							{/each}
							<details class="filtered-page__all-dimensions">
								<summary
									>All reading attributes{moreReadingCount
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

					{#if formError}<p class="filtered-page__form-error" role="alert">{formError}</p>{/if}
					{#if !canSubmit}
						<p class="filtered-page__eligibility">
							{#if $ratingsStore.size < MIN_RATINGS}
								Rate at least ten books to start a search.
							{:else if $ratingsSyncMeta.queuedCount > 0 || $ratingsSyncMeta.isFlushing}
								Wait for your ratings to finish saving before searching.
							{:else}
								Open Browse to start your reading session.
							{/if}
							<a href={resolve('/rate')}>Browse books</a>
						</p>
					{/if}
					<div class="filtered-page__actions">
						<button
							type="submit"
							class="btn btn--primary"
							disabled={!canSubmit || submitting || requestIsRunning}
						>
							{submitting ? 'Starting…' : 'Find books'}
						</button>
						<button
							type="button"
							class="btn btn--tertiary"
							onclick={() => {
								draft = emptyFilterDraft();
								formVersion += 1;
								formError = '';
							}}>Clear filters</button
						>
					</div>
				{/key}
			</form>
		</aside>

		<section class="filtered-page__results" aria-label="Filtered recommendation results">
			{#if request}
				<div class="filtered-page__run-heading">
					<h2 class="typ-h2">Your matches</h2>
					<p>{describeFilters(submittedFilters)}</p>
				</div>
			{:else}
				<h2 class="typ-h2">Your matches</h2>
			{/if}
			{#if viewState === 'idle'}
				<p>
					Choose filters and select Find books. Each search creates a personalized list of up to ten
					books.
				</p>
			{:else if viewState === 'loading' || viewState === 'slow'}
				<p role="status">
					{viewState === 'slow'
						? 'This is taking longer than usual. The request is still running.'
						: request?.status === 'pending'
							? 'Waiting to start your search…'
							: 'Finding books that match your filters…'}
				</p>
				{#if message}<p>{message}</p>{/if}
				<BookCardGridSkeleton ariaLabel="Finding matching books" count={10} />
			{:else if viewState === 'paused'}
				<p>
					This request is still pending. It may complete later; starting another search creates a
					separate request.
				</p>
				{#if requestId}<p>Request #{requestId}</p>{/if}
				<button type="button" class="btn btn--secondary" onclick={checkAgain}>Check status</button>
			{:else if viewState === 'failed' || viewState === 'error' || viewState === 'unavailable' || viewState === 'legacy'}
				<p role="alert">
					{message ||
						(viewState === 'legacy'
							? 'This older request has no recorded outcome.'
							: 'This request is unavailable.')}
				</p>
				{#if requestId}<p>Request #{requestId}</p>{/if}
				{#if viewState === 'error'}<button
						type="button"
						class="btn btn--secondary"
						onclick={checkAgain}>Load again</button
					>{/if}
				{#if viewState === 'failed'}<button
						type="button"
						class="btn btn--secondary"
						disabled={!canSubmit || submitting}
						onclick={() => void submit()}>Try again with these filters</button
					>{/if}
			{:else if viewState === 'empty'}
				<p>No unread books matched this request. Try broader filters or another combination.</p>
				<button
					type="button"
					class="btn btn--secondary"
					onclick={() => document.getElementById('filter-genres')?.focus()}>Edit filters</button
				>
			{:else if viewState === 'ready' && result}
				<p>
					{result.books.length}
					{result.books.length === 1 ? 'book' : 'books'} in this run, in recommendation order.
				</p>
				<ul
					class="book-card-grid filtered-page__grid"
					aria-label="Books matching your filters"
					use:trackGridColumns={(columns) => (gridColumns = columns)}
				>
					{#each result.books as book, index (book.book_id)}
						<li>
							<BookCard
								{book}
								context="recommendations"
								coverPriority={coverPriorityFor(index, gridColumns)}
								likedBookPrecedents={filterRatedLikedBookPrecedents(
									result.likedBookPrecedentsByBookId[book.book_id] ?? [],
									$ratingsStore
								)}
								authorRelationshipAuthors={filterAuthorRelationshipAuthors(
									result.authorRelationshipAuthorsByBookId[book.book_id] ?? [],
									cleanLikedAuthors
								)}
								dimensionMatches={result.dimensionMatchSnapshotsByBookId[book.book_id]?.matches ??
									[]}
								bookmarked={$planToReadStore.has(book.id)}
								onBookmark={() => handleBookmark(book)}
								currentRating={$ratingsStore.get(book.id) ?? null}
								onRate={(_id, value) => handleRate(book, value)}
								onRemoveRating={() => ratingsStore.removeRating(book.id, book.book_id)}
								notInterested={$notInterestedStore.has(book.book_id)}
								onNotInterested={() => handleNotInterested(book)}
							/>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	{#if recent.length}
		<section class="filtered-page__recent" aria-label="Recent filtered searches">
			<h2 class="typ-h2">Recent searches</h2>
			<ul>
				{#each recent as item (String(item.id))}
					<li>
						<a
							href={resolve(
								`/rate/recommendations/filtered?request_id=${encodeURIComponent(String(item.id))}`
							)}
							aria-current={requestId === String(item.id) ? 'page' : undefined}
						>
							<strong>{describeFilters(item.filters)}</strong>
							<span
								>{item.created_at ? new Date(item.created_at).toLocaleDateString() : ''} · {item.status ??
									'Older request'}</span
							>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.filtered-page {
		max-width: 94rem;
		margin: 0 auto;
		padding: 0 var(--space-4) var(--space-8);
	}
	.filtered-page__header {
		max-width: 46rem;
		margin: 0 auto var(--space-6);
		text-align: center;
	}
	.filtered-page__header h1 {
		margin: 0 0 var(--space-2);
	}
	.filtered-page__header p {
		color: var(--color-text-muted);
	}
	.filtered-page__tabs {
		display: flex;
		justify-content: center;
		gap: var(--space-4);
		margin-top: var(--space-4);
	}
	.filtered-page__tabs a {
		color: var(--color-text-muted);
		padding: var(--space-2);
		text-decoration: none;
		border-bottom: 2px solid transparent;
	}
	.filtered-page__tabs a[aria-current='page'] {
		color: var(--color-text);
		border-color: var(--color-text);
	}
	.filtered-page__layout {
		display: grid;
		grid-template-columns: minmax(20rem, 25rem) minmax(0, 1fr);
		align-items: start;
		gap: var(--space-6);
	}
	.filtered-page__filters {
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-4);
	}
	.filtered-page__filters form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.filtered-page__filters h2 {
		margin: 0;
	}
	.filtered-page__types {
		border: 0;
		padding: 0;
		margin: 0;
	}
	.filtered-page__types legend {
		font-weight: 600;
		margin-bottom: var(--space-2);
	}
	.filtered-page__type-options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		padding: var(--space-1);
	}
	.filtered-page__type-options label {
		position: relative;
		min-height: 2.5rem;
		display: grid;
		place-items: center;
		border-radius: var(--radius-pill);
		font-size: var(--typ-caption-font-size);
		cursor: pointer;
	}
	.filtered-page__type-options label.active {
		background: var(--color-floating-control-bg);
		font-weight: 600;
	}
	.filtered-page__type-options label:focus-within {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.filtered-page__type-options input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.filtered-page__matching-note {
		margin: calc(-1 * var(--space-3)) 0 0;
		color: var(--color-text-muted);
		font-size: var(--typ-caption-font-size);
	}
	.filtered-page__advanced,
	.filtered-page__dimensions,
	.filtered-page__all-dimensions {
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-3);
	}
	.filtered-page__advanced summary,
	.filtered-page__dimensions summary,
	.filtered-page__all-dimensions summary {
		cursor: pointer;
		font-weight: 600;
	}
	.filtered-page__advanced p,
	.filtered-page__dimensions p,
	.filtered-page__eligibility {
		color: var(--color-text-muted);
		font-size: var(--typ-caption-font-size);
	}
	.filtered-page__range-grid {
		display: grid;
		gap: var(--space-5);
		margin: var(--space-4) 0;
	}
	.filtered-page__all-dimensions {
		margin-top: var(--space-4);
	}
	.filtered-page__form-error {
		color: var(--color-error-text);
		margin: 0;
	}
	.filtered-page__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.filtered-page__results {
		min-height: 24rem;
	}
	.filtered-page__results h2 {
		margin-bottom: var(--space-2);
	}
	.filtered-page__results p {
		color: var(--color-text-muted);
	}
	.filtered-page__run-heading p {
		margin: 0 0 var(--space-4);
	}
	.filtered-page__grid {
		margin-top: var(--space-4);
	}
	.filtered-page__recent {
		margin-top: var(--space-8);
	}
	.filtered-page__recent ul {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: var(--space-3);
		list-style: none;
		padding: 0;
	}
	.filtered-page__recent a {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		height: 100%;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-3);
		color: var(--color-text);
		text-decoration: none;
	}
	.filtered-page__recent a[aria-current='page'] {
		border-color: var(--color-focus);
	}
	.filtered-page__recent span {
		color: var(--color-text-muted);
		font-size: var(--typ-caption-font-size);
	}
	@media (max-width: 850px) {
		.filtered-page__layout {
			grid-template-columns: 1fr;
		}
		.filtered-page__results {
			min-height: 12rem;
		}
	}
	@media (max-width: 479px) {
		.filtered-page {
			padding-inline: 0;
		}
		.filtered-page__filters {
			padding: var(--space-3);
		}
	}
</style>
