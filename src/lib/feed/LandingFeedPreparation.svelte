<script lang="ts">
	import { readable } from 'svelte/store';
	import { authReady, authStore } from '$lib/stores/auth';
	import { MAINTENANCE_ON } from '$lib/maintenance';
	import { getRateFeedContext } from './rateFeedContext';

	const controller = getRateFeedContext();
	const feed = controller ?? readable({ ownerId: null });
	let attemptedOwner: string | null = null;

	$effect(() => {
		const user = $authStore.user;
		const session = $authStore.session;
		const ownerId = $feed.ownerId;
		if (
			MAINTENANCE_ON ||
			!$authReady ||
			!controller ||
			!user ||
			!session?.access_token ||
			ownerId !== user.id
		) {
			attemptedOwner = null;
			return;
		}
		if (attemptedOwner === user.id) return;
		attemptedOwner = user.id;
		// Read-only; navigation shares the request even after this component unmounts.
		// A failed attempt does not start a retry loop while the visitor remains here.
		void controller
			.prepare({ userId: user.id, accessToken: session.access_token })
			.catch(() => undefined);
	});
</script>
