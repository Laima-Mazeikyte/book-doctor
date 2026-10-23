<script lang="ts">
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { libraryLoads, type LibraryCollection } from '$lib/stores/libraryLoads';
	import { t } from '$lib/copy';
	let {
		collections,
		label = 'books'
	}: {
		collections: readonly LibraryCollection[];
		label?: 'books' | 'ratings' | 'bookmarks' | 'dismissals';
	} = $props();
	const states = $derived(
		$libraryLoads.userId === $authStore.user?.id
			? collections.map((kind) => ({ kind, ...$libraryLoads.collections[kind] }))
			: []
	);
	const failed = $derived(states.filter((state) => state.status === 'error'));
	const retrying = $derived(states.some((state) => state.status === 'retrying'));
	const cached = $derived(
		states
			.filter((state) => ['error', 'retrying'].includes(state.status))
			.every((state) => state.hasSnapshot)
	);
	onMount(() => {
		if ($authStore.user) void libraryLoads.visit(collections);
	});
	const collectionLabel = $derived.by(() => {
		const affected = states.filter((state) => ['error', 'retrying'].includes(state.status));
		const labels = new Set(
			affected.map((state) =>
				state.kind === 'ratedDetails' || state.kind === 'ratings'
					? 'ratings'
					: state.kind === 'bookmarkDetails' || state.kind === 'bookmarks'
						? 'bookmarks'
						: 'dismissals'
			)
		);
		return labels.size === 1 ? [...labels][0] : label;
	});
</script>

{#if failed.length > 0 || retrying}
	<div
		class="library-load-notice typ-body"
		role={failed.length ? 'alert' : 'status'}
		data-testid="library-load-notice"
	>
		<span
			>{t(cached ? 'libraryLoad.refreshError' : 'libraryLoad.loadError', {
				collection: t(`libraryLoad.${collectionLabel}`)
			})}</span
		>
		{#if failed.length > 0}
			<button
				type="button"
				onclick={() => void libraryLoads.retry(failed.map((state) => state.kind))}
			>
				{t('libraryLoad.retry')}
			</button>
		{:else}
			<span>{t('libraryLoad.retrying')}</span>
		{/if}
	</div>
{/if}

<style>
	.library-load-notice {
		min-width: 0;
		max-width: 100%;
		pointer-events: auto;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		padding: var(--space-3);
	}
	button {
		color: inherit;
		font: inherit;
		text-decoration: underline;
		border: 0;
		background: transparent;
		cursor: pointer;
		min-height: var(--min-tap);
	}
	button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
