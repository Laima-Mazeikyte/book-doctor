<script lang="ts">
	import RatePage from '../../../routes/rate/+page.svelte';
	import { setRateFeedContext } from '../rateFeedContext';
	import type { RateFeedController } from '../rateFeedController';

	let { controller }: { controller: RateFeedController } = $props();
	// Each mounted harness intentionally provides one fixed controller instance.
	// svelte-ignore state_referenced_locally
	setRateFeedContext(controller);
</script>

<RatePage />
