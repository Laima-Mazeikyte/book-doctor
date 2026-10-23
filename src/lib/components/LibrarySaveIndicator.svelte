<script lang="ts">
	import { librarySaves, type LibrarySaveKind } from '$lib/stores/librarySaves';
	import RatingsSyncDot from './RatingsSyncDot.svelte';
	import { t } from '$lib/copy';
	let { bookUlid, kind }: { bookUlid: string; kind: LibrarySaveKind } = $props();
	const change = $derived(
		$librarySaves.changes.find((c) => c.bookUlid === bookUlid && c.kind === kind)
	);
	const label = $derived(
		change?.status === 'failed' ? t('librarySaves.unsaved') : t('librarySaves.saving')
	);
</script>

{#if change}
	<span role="img" aria-label={label} title={label}>
		<RatingsSyncDot variant={change.status === 'failed' ? 'failed' : 'pending'} />
	</span>
{/if}
