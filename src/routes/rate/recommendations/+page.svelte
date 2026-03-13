<script lang="ts">
	import { ratingsStore } from '$lib/stores/ratings';
	import RecommendationsEmpty from '$lib/components/RecommendationsEmpty.svelte';
</script>

<RecommendationsEmpty ratedCount={$ratingsStore.size} />
