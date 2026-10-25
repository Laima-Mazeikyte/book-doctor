<script lang="ts">
	import LandingFeedPreparation from '../LandingFeedPreparation.svelte';
	import { setRateFeedContext } from '../rateFeedContext';
	import type { RateFeedController } from '../rateFeedController';
	let { controller }: { controller: RateFeedController } = $props();
	// svelte-ignore state_referenced_locally
	setRateFeedContext(controller);
</script>

<LandingFeedPreparation />
