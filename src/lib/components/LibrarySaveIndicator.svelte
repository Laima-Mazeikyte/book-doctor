<script lang="ts">
	import { librarySaves, type LibrarySaveKind } from '$lib/stores/librarySaves';
	import RatingsSyncDot from './RatingsSyncDot.svelte';
	import { t } from '$lib/copy';
	let { bookUlid, kind }: { bookUlid: string; kind: LibrarySaveKind } = $props();
	const change = $derived(
		$librarySaves.changes.find((c) => c.bookUlid === bookUlid && c.kind === kind)
	);
</script>

{#if change?.status === 'failed'}
	<span role="img" aria-label={t('librarySaves.unsaved')} title={t('librarySaves.unsaved')}>
		<RatingsSyncDot variant="failed" />
	</span>
{/if}
