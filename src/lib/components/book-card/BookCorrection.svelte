<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import { SvelteMap } from 'svelte/reactivity';
	import {
		ArrowLeft,
		Calendar,
		ChevronRight,
		FileText,
		Image,
		Pencil,
		Plus,
		Tags,
		Type,
		UserRound,
		X
	} from 'lucide-svelte';
	import Button from '$lib/components/Button.svelte';
	import { authStore, isAnonymousOrSignedOut } from '$lib/stores/auth';
	import { t } from '$lib/copy';
	import filterOptions from '$lib/recommendations/filter-options.generated.json';
	import { loadCorrectionContext, saveCorrection, withdrawCorrection } from '$lib/corrections/api';
	import { CorrectionRequestError } from '$lib/corrections/errors';
	import { anchorPanelBottom } from '$lib/corrections/anchorPanelBottom';
	import {
		applyCorrection,
		diffCorrection,
		genreKey,
		isCoverImageUrl,
		normalizeGenre,
		parseCorrectionChanges,
		valuesFromBook,
		MAX_GENRES,
		MIN_GENRE_LENGTH,
		MAX_GENRE_LENGTH,
		TEXT_LIMITS,
		DESCRIPTION_ISSUE_LIMIT,
		CORRECTION_FIELDS,
		DESCRIPTION_ISSUE_CATEGORIES,
		EMPTY_CORRECTION_MESSAGES,
		type CorrectionContext,
		type CorrectionValues,
		type CorrectionField
	} from '$lib/corrections/model';
	import type { Book } from '$lib/types/book';

	let { book }: { book: Book } = $props();
	const uid = $props.id();
	let context = $state<CorrectionContext | null>(null);
	let draft = $state<CorrectionValues>(untrack(() => valuesFromBook(book)));
	let draftBaseline = $state<CorrectionValues | null>(null);
	let selectedField = $state<CorrectionField | null>(null);
	let issue = $state({ category: '', explanation: '' });
	let proposalId = $state('');
	let open = $state(false);
	let loading = $state(false);
	let busy = $state(false);
	let failure = $state('');
	let recovery = $state<'reload' | 'retry' | null>(null);
	let notice = $state('');
	let genreInput = $state('');
	let previewUrl = $state('');
	let previewFailed = $state(false);
	let editorRoot: HTMLFieldSetElement | undefined = $state();
	let entryButton: HTMLButtonElement | undefined = $state();
	let pickerRoot: HTMLDivElement | undefined = $state();
	let generation = 0;
	let refreshVersion = 0;
	const drafts = new SvelteMap<
		CorrectionField,
		{
			values: CorrectionValues;
			baseline: CorrectionValues;
			issue: { category: string; explanation: string };
			proposalId: string;
			genreInput: string;
			previewUrl: string;
			previewFailed: boolean;
		}
	>();
	const fieldIcons = {
		title: Type,
		author: UserRound,
		year: Calendar,
		description: FileText,
		coverUrl: Image,
		genres: Tags
	};
	const registeredUserId = $derived($isAnonymousOrSignedOut ? null : $authStore.user?.id);
	const pending = $derived(context?.pending.find((proposal) => proposal.field === selectedField));
	const baseline = $derived(
		draftBaseline ?? pending?.original_values ?? context?.catalog ?? valuesFromBook(book)
	);
	const atLimit = $derived(!!context && context.remaining === 0 && !pending);
	const genresAtLimit = $derived(draft.genres.length >= MAX_GENRES);
	const resetTime = $derived(
		context?.resetsAt
			? new Date(context.resetsAt).toLocaleString(undefined, {
					hour: 'numeric',
					minute: '2-digit',
					month: 'short',
					day: 'numeric',
					timeZoneName: 'short'
				})
			: ''
	);
	const genreOptions = $derived(
		filterOptions.genres.filter((g) => !draft.genres.some((d) => genreKey(d) === genreKey(g)))
	);

	async function selectField(field: CorrectionField | null, reload = false) {
		const previousField = selectedField;
		if (previousField && !reload) {
			drafts.set(previousField, {
				values: { ...draft, genres: [...draft.genres] },
				baseline: { ...baseline, genres: [...baseline.genres] },
				issue: { ...issue },
				proposalId,
				genreInput,
				previewUrl,
				previewFailed
			});
		}
		selectedField = field;
		if (field) {
			const saved = reload ? undefined : drafts.get(field);
			const proposal = context?.pending.find((p) => p.field === field);
			draftBaseline =
				saved?.baseline ?? proposal?.original_values ?? context?.catalog ?? valuesFromBook(book);
			draft = saved?.values ?? applyCorrection(draftBaseline, proposal?.proposed_changes ?? {});
			issue = {
				...(saved?.issue ??
					proposal?.proposed_changes.description ?? { category: '', explanation: '' })
			};
			proposalId = saved?.proposalId ?? proposal?.id ?? crypto.randomUUID();
			genreInput = saved?.genreInput ?? '';
			previewUrl = saved?.previewUrl ?? '';
			previewFailed = saved?.previewFailed ?? false;
		}
		failure = '';
		recovery = null;
		await tick();
		if (field) {
			editorRoot
				?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled])')
				?.focus({ preventScroll: true });
		} else if (previousField) {
			pickerRoot
				?.querySelector<HTMLButtonElement>(`[data-field="${previousField}"]`)
				?.focus({ preventScroll: true });
		}
	}

	function populate(next: CorrectionContext) {
		context = next;
		if (selectedField) {
			drafts.delete(selectedField);
			void selectField(selectedField, true);
		}
	}

	async function refresh(signal?: AbortSignal, background = false) {
		const current = generation;
		const request = ++refreshVersion;
		if (!background) {
			loading = true;
			failure = '';
			recovery = null;
		}
		try {
			const next = await loadCorrectionContext(book.book_id, signal);
			if (current !== generation || request !== refreshVersion) return;
			// A quiet refresh must never replace a draft or a successful submission.
			if (background) {
				if (!selectedField && !busy) context = next;
			} else populate(next);
		} catch (error) {
			if (current === generation && request === refreshVersion && !signal?.aborted && !background) {
				failure = message(error);
				recovery = 'retry';
			}
		} finally {
			if (current === generation && request === refreshVersion && !background) loading = false;
		}
	}

	$effect(() => {
		const userId = registeredUserId;
		const bookId = book.book_id;
		untrack(() => {
			generation++;
			context = null;
			drafts.clear();
			draftBaseline = null;
			selectedField = null;
			open = false;
			busy = false;
			notice = '';
			failure = '';
			recovery = null;
		});
		if (!userId || !bookId) return;
		const controller = new AbortController();
		untrack(() => {
			void refresh(controller.signal);
		});
		return () => {
			generation++;
			controller.abort();
		};
	});

	function message(error: unknown): string {
		return error instanceof Error ? error.message : t('bookCorrections.error');
	}
	function requestFailed(error: unknown) {
		failure = message(error);
		recovery = error instanceof CorrectionRequestError && error.status === 409 ? 'reload' : null;
	}
	async function showEditor() {
		open = true;
		selectedField = null;
		notice = '';
		failure = '';
		recovery = null;
		if (!loading) await refresh(undefined, !!context);
	}
	async function closeEditor() {
		if (busy) return;
		open = false;
		drafts.clear();
		draftBaseline = null;
		selectedField = null;
		failure = '';
		recovery = null;
		await tick();
		entryButton?.focus({ preventScroll: true });
	}

	function addGenre() {
		recovery = null;
		const label = normalizeGenre(genreInput);
		if (!label) return;
		if ([...label].length < MIN_GENRE_LENGTH || [...label].length > MAX_GENRE_LENGTH) {
			failure = t('bookCorrections.genreLength');
			return;
		}
		if (draft.genres.some((g) => genreKey(g) === genreKey(label))) {
			failure = t('bookCorrections.genreDuplicate');
			return;
		}
		if (genresAtLimit) {
			failure = t('bookCorrections.genreLimit');
			return;
		}
		draft.genres = [...draft.genres, label];
		genreInput = '';
		failure = '';
	}
	function previewCover() {
		recovery = null;
		if (!isCoverImageUrl(draft.coverUrl.trim())) {
			failure = t('bookCorrections.invalidCover');
			return;
		}
		failure = '';
		previewFailed = false;
		previewUrl = draft.coverUrl.trim();
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || loading || !context || !selectedField || atLimit) return;
		failure = '';
		recovery = null;
		if (selectedField === 'genres' && genreInput.trim()) {
			failure = t('bookCorrections.unaddedGenre');
			return;
		}
		if (selectedField === 'genres' && draft.genres.length > MAX_GENRES) {
			failure = t('bookCorrections.genreLimit');
			return;
		}
		let changes;
		try {
			const proposedChanges = diffCorrection(baseline, draft, selectedField, issue);
			if (Object.keys(proposedChanges).length === 0) {
				if (pending) {
					await withdraw();
					return;
				}
				throw new Error(EMPTY_CORRECTION_MESSAGES[selectedField]);
			}
			changes = parseCorrectionChanges(proposedChanges);
		} catch (error) {
			failure = message(error);
			return;
		}
		busy = true;
		refreshVersion++;
		const current = generation;
		try {
			const next = await saveCorrection(book.book_id, proposalId, changes);
			if (current !== generation) return;
			context = next;
			busy = false;
			await closeEditor();
			notice = t('bookCorrections.thanks');
		} catch (error) {
			if (current === generation) requestFailed(error);
		} finally {
			if (current === generation) busy = false;
		}
	}

	async function withdraw() {
		if (busy || loading || !pending || !context) return;
		const id = pending.id;
		busy = true;
		refreshVersion++;
		failure = '';
		recovery = null;
		const current = generation;
		try {
			await withdrawCorrection(book.book_id, id);
			if (current !== generation) return;
			context = { ...context, pending: context.pending.filter((p) => p.id !== id) };
			busy = false;
			await closeEditor();
			notice = t('bookCorrections.withdrawn');
		} catch (error) {
			if (current === generation) requestFailed(error);
		} finally {
			if (current === generation) busy = false;
		}
	}
</script>

{#if !$isAnonymousOrSignedOut}
	<section class="correction" aria-label={t('bookCorrections.title')}>
		<button
			bind:this={entryButton}
			type="button"
			class="correction__entry"
			aria-expanded={open}
			aria-controls="{uid}-editor"
			disabled={busy}
			onclick={() => (open ? closeEditor() : showEditor())}
		>
			<Pencil size={14} aria-hidden="true" />
			{context?.pending.length ? t('bookCorrections.viewPending') : t('bookCorrections.title')}
		</button>
		{#if notice}<p class="correction__notice" role="status">{notice}</p>{/if}
		{#if open}
			<form
				id="{uid}-editor"
				class="correction__panel"
				aria-busy={loading}
				onsubmit={submit}
				use:anchorPanelBottom
				in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}
			>
				{#if loading && !context}<p role="status">{t('bookCorrections.loading')}</p>
				{:else if context}
					{#if context.remaining === 0}
						<p class="correction__hint" role="status">
							{t('bookCorrections.limitReached')}
							{#if resetTime}{t('bookCorrections.reset', { time: resetTime })}{/if}
						</p>
					{/if}
					{#if !selectedField}
						<div
							onintrostart={(event) => (event.currentTarget.inert = false)}
							onoutrostart={(event) => (event.currentTarget.inert = true)}
							transition:slide|local={{ duration: prefersReducedMotion.current ? 0 : 160 }}
						>
							<h4 class="typ-h3">{t('bookCorrections.title')}</h4>
							<div class="correction__fields" bind:this={pickerRoot}>
								{#each CORRECTION_FIELDS as field (field)}
									{@const Icon = fieldIcons[field]}
									<button
										type="button"
										class="correction__field"
										data-field={field}
										aria-label={t('bookCorrections.fields.' + field)}
										onclick={() => selectField(field)}
									>
										<span class="correction__field-icon"><Icon size={16} aria-hidden="true" /></span
										>
										<span class="correction__field-label"
											>{t('bookCorrections.fields.' + field)}</span
										>
										{#if context.pending.some((p) => p.field === field)}<span
												class="correction__badge">{t('bookCorrections.pendingBadge')}</span
											>{/if}
										<ChevronRight size={15} aria-hidden="true" class="correction__chevron" />
									</button>
								{/each}
							</div>
						</div>
					{:else}
						<div
							onintrostart={(event) => (event.currentTarget.inert = false)}
							onoutrostart={(event) => (event.currentTarget.inert = true)}
							transition:slide|local={{ duration: prefersReducedMotion.current ? 0 : 160 }}
						>
							<div class="correction__heading">
								<button
									type="button"
									class="correction__back"
									aria-label={t('bookCorrections.changeField')}
									disabled={busy || loading}
									onclick={() => selectField(null)}
								>
									<ArrowLeft size={18} aria-hidden="true" />
								</button>
								<h4 class="typ-h3">{t('bookCorrections.fields.' + selectedField)}</h4>
							</div>
							{#if pending}<p class="correction__hint">{t('bookCorrections.pending')}</p>{/if}
							<fieldset bind:this={editorRoot} disabled={busy || loading || atLimit}>
								{#if selectedField === 'title' || selectedField === 'author'}
									<label for="{uid}-value">{t('bookCorrections.fields.' + selectedField)}</label>
									<input
										id="{uid}-value"
										bind:value={draft[selectedField]}
										maxlength={TEXT_LIMITS[selectedField]}
									/>
								{:else if selectedField === 'year'}
									<label for="{uid}-year">{t('bookCorrections.fields.year')}</label>
									<input
										id="{uid}-year"
										inputmode="numeric"
										bind:value={draft.year}
										maxlength="5"
									/>
								{:else if selectedField === 'description'}
									<p class="correction__description">
										{baseline.summary || t('bookCorrections.noDescription')}
									</p>
									<fieldset class="correction__categories">
										<legend>{t('bookCorrections.issueCategory')}</legend>
										<div class="correction__category-options">
											{#each DESCRIPTION_ISSUE_CATEGORIES as category (category)}
												<label class="correction__category">
													<input
														type="radio"
														name="{uid}-category"
														value={category}
														bind:group={issue.category}
													/>
													<span>{t('bookCorrections.categories.' + category)}</span>
												</label>
											{/each}
										</div>
									</fieldset>
									<label for="{uid}-explanation">{t('bookCorrections.issueExplanation')}</label>
									<textarea
										id="{uid}-explanation"
										bind:value={issue.explanation}
										maxlength={DESCRIPTION_ISSUE_LIMIT}
										rows="4"
									></textarea>
								{:else if selectedField === 'coverUrl'}
									<label for="{uid}-cover">{t('bookCorrections.fields.coverUrl')}</label>
									<input
										id="{uid}-cover"
										type="url"
										bind:value={draft.coverUrl}
										maxlength={TEXT_LIMITS.coverUrl}
										placeholder="https://…"
										oninput={() => {
											previewUrl = '';
											previewFailed = false;
										}}
									/>
									<Button variant="secondary" compact onclick={previewCover}
										>{t('bookCorrections.preview')}</Button
									>
									{#if previewUrl}<div
											class="correction__preview"
											transition:slide|local={{ duration: prefersReducedMotion.current ? 0 : 160 }}
										>
											{#if !previewFailed}<img
													class="correction__cover"
													src={previewUrl}
													alt={t('bookCorrections.previewAlt')}
													referrerpolicy="no-referrer"
													onerror={() => (previewFailed = true)}
												/>
											{:else}<p class="correction__hint" role="status">
													{t('bookCorrections.previewFailed')}
												</p>{/if}
										</div>{/if}
								{:else if selectedField === 'genres'}
									<ul class="correction__genres" aria-label={t('bookCorrections.selectedGenres')}>
										{#each draft.genres as genre, index (index)}<li>
												<span>{genre}</span><button
													type="button"
													aria-label={t('bookCorrections.removeGenre', { genre })}
													onclick={() =>
														(draft.genres = draft.genres.filter((_, i) => i !== index))}
													><X size={12} aria-hidden="true" /></button
												>
											</li>{/each}
									</ul>
									<div class="correction__genre-entry">
										<input
											id="{uid}-genre"
											aria-label={t('bookCorrections.fields.genres')}
											aria-describedby={genresAtLimit ? uid + '-genre-limit' : undefined}
											bind:value={genreInput}
											disabled={genresAtLimit}
											list="{uid}-genres"
											maxlength={MAX_GENRE_LENGTH}
											placeholder={t('bookCorrections.genrePlaceholder')}
											onkeydown={(event) => {
												if (event.key === 'Enter') {
													event.preventDefault();
													addGenre();
												}
											}}
										/>
										<Button
											variant="secondary"
											compact
											disabled={genresAtLimit}
											onclick={addGenre}
											aria-label={t('bookCorrections.addGenre')}
											><Plus size={16} aria-hidden="true" /></Button
										>
									</div>
									<datalist id="{uid}-genres"
										>{#each genreOptions as genre (genre)}<option value={genre}
											></option>{/each}</datalist
									>
									{#if genresAtLimit}<p
											id="{uid}-genre-limit"
											class="correction__hint"
											role="status"
										>
											{t('bookCorrections.genreLimit')}
										</p>{/if}
								{/if}
							</fieldset>
						</div>
					{/if}
				{/if}
				{#if failure}<p class="correction__error" role="alert">{failure}</p>
					{#if recovery}
						<Button variant="tertiary" compact disabled={busy || loading} onclick={() => refresh()}
							>{t(
								recovery === 'reload' ? 'bookCorrections.reload' : 'bookCorrections.retryLoading'
							)}</Button
						>
					{/if}
				{/if}
				<div class="correction__actions">
					{#if selectedField && context}
						<Button type="submit" disabled={busy || loading || atLimit}
							>{busy
								? t('bookCorrections.saving')
								: pending
									? t('bookCorrections.update')
									: t('bookCorrections.submit')}</Button
						>
						{#if pending}<Button variant="tertiary" disabled={busy || loading} onclick={withdraw}
								>{t('bookCorrections.withdraw')}</Button
							>{/if}
					{:else}
						<Button variant="tertiary" onclick={closeEditor}>{t('bookCorrections.close')}</Button>
					{/if}
				</div>
			</form>
		{/if}
	</section>
{/if}

<style>
	.correction {
		margin-top: var(--space-4);
		font-size: var(--typ-body-font-size);
	}
	.correction__entry {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--min-tap);
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 4px;
	}
	.correction__entry:hover {
		color: var(--color-text);
	}
	.correction__entry:disabled {
		cursor: wait;
	}
	.correction__panel {
		container-type: inline-size;
		overflow-anchor: none;
		margin-top: var(--space-2);
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card-bg);
	}
	.correction__panel h4 {
		margin: 0 0 var(--space-2);
	}
	.correction__heading {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin-bottom: var(--space-2);
	}
	.correction__heading h4 {
		margin: 0;
	}
	.correction__back {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--min-tap);
		min-width: var(--min-tap);
		justify-content: center;
		margin-left: calc(-1 * var(--space-2));
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default);
	}
	.correction__back:hover:not(:disabled) {
		background: var(--color-interactive-hover-subtle);
	}
	.correction__back:disabled {
		cursor: wait;
	}
	.correction__hint {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		margin: var(--space-2) 0;
	}
	.correction fieldset {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: 0;
		margin: var(--space-4) 0;
		border: 0;
		min-width: 0;
	}
	.correction label {
		margin-top: var(--space-2);
		font-weight: 600;
	}
	.correction input,
	.correction textarea {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}
	.correction textarea {
		resize: vertical;
	}
	.correction input:focus-visible,
	.correction textarea:focus-visible,
	.correction button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.correction__genres {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: 0;
		margin: 0;
		list-style: none;
	}
	.correction__genres li {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		max-width: 100%;
		padding: 0 var(--space-2) 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		overflow-wrap: anywhere;
	}
	.correction__genres button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 36px;
		min-height: 40px;
		border: 0;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}
	.correction__genre-entry {
		display: flex;
		gap: var(--space-2);
	}
	.correction__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0 calc(-1 * var(--space-4)) calc(-1 * var(--space-4));
		padding: var(--space-3) var(--space-4) var(--space-4);
		border-top: 1px solid var(--color-border);
		border-radius: 0 0 var(--radius) var(--radius);
		background: var(--color-card-bg);
	}
	.correction__fields {
		display: grid;
		gap: var(--space-1);
		margin: var(--space-2) 0 var(--space-4);
	}
	.correction__field {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--min-tap);
		padding: var(--space-2) var(--space-3);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default);
	}
	.correction__field:hover {
		background: var(--color-interactive-hover-subtle);
	}
	.correction__field-label {
		flex: 1;
	}
	.correction__field-icon {
		display: flex;
		color: var(--color-text-muted);
	}
	.correction__field :global(.correction__chevron) {
		flex-shrink: 0;
		color: var(--color-text-muted);
	}
	.correction__badge {
		padding: 0 var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--color-bg-muted);
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}
	.correction fieldset.correction__categories {
		display: block;
		margin: var(--space-2) 0 0;
	}
	.correction__categories legend {
		padding: 0;
		margin-bottom: var(--space-2);
		font-weight: 600;
	}
	.correction__category-options {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.correction .correction__category {
		position: relative;
		margin: 0;
		font-weight: inherit;
		cursor: pointer;
	}
	.correction__category input[type='radio'] {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		border: 0;
		clip-path: inset(50%);
		overflow: hidden;
	}
	.correction__category span {
		display: inline-flex;
		align-items: center;
		min-height: var(--min-tap);
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-book-card-pill-surface-bg);
		color: var(--color-text);
		transition:
			background var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
	}
	.correction__category:hover input:not(:disabled) + span {
		background: var(--color-book-card-pill-surface-bg-hover);
	}
	.correction__category input:checked + span {
		border-color: var(--color-book-card-chip-on-border);
		background: var(--color-book-card-chip-on-bg);
		color: var(--color-book-card-chip-on-text);
	}
	.correction__category:hover input:checked:not(:disabled) + span {
		background: var(--color-book-card-chip-on-bg-hover);
	}
	.correction__category input:focus-visible + span {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.correction__category input:disabled + span {
		opacity: 0.5;
		cursor: default;
	}
	@container (max-width: 360px) {
		.correction__category-options {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.correction__category span {
			width: 100%;
			justify-content: center;
		}
	}
	.correction__description {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.correction__notice {
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--color-bg-muted);
	}
	.correction__error {
		color: var(--color-error-text);
	}
	.correction__cover {
		display: block;
		width: 100px;
		height: 150px;
		object-fit: contain;
		margin-top: var(--space-2);
		border-radius: var(--radius-sm);
	}
	@media (prefers-reduced-motion: reduce) {
		.correction__back,
		.correction__field,
		.correction__category span {
			transition: none;
		}
	}
</style>
