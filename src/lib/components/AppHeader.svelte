<script lang="ts">
	import { getSupabase } from '$lib/supabase';
	import { authStore, isAnonymousOrSignedOut, signedInEmail } from '$lib/stores/auth';
	import AuthModal from '$lib/components/AuthModal.svelte';
	import Button from '$lib/components/Button.svelte';

	let authModalOpen = $state(false);
	let showAuthActions = $derived($isAnonymousOrSignedOut);
	let email = $derived($signedInEmail);

	function openAuthModal() {
		authModalOpen = true;
	}

	function closeAuthModal() {
		authModalOpen = false;
	}

	function handleSignOut() {
		getSupabase()?.auth.signOut();
	}
</script>

<header class="app-header">
	<div class="app-header__inner">
		{#if showAuthActions}
			<div class="app-header__auth">
				<Button variant="tertiary" compact onclick={openAuthModal}>Create account</Button>
				<Button variant="secondary" compact onclick={openAuthModal}>Sign in</Button>
			</div>
		{:else if email}
			<div class="app-header__auth app-header__auth--signed-in">
				<Button href="/rate/recommendations" variant="tertiary" compact>My recommendations</Button>
				<span class="app-header__email" title={email}>{email}</span>
				<Button variant="tertiary" compact onclick={handleSignOut}>Sign out</Button>
			</div>
		{/if}
	</div>
</header>

<AuthModal open={authModalOpen} onClose={closeAuthModal} />

<style>
	.app-header {
		background: var(--color-card-bg);
		border-bottom: 1px solid var(--color-border);
	}
	.app-header__inner {
		max-width: var(--content-width-narrow);
		margin: 0 auto;
		padding: var(--space-3) var(--space-4);
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.app-header__auth {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-left: auto;
	}
	.app-header__auth--signed-in {
		gap: var(--space-4);
	}
	.app-header__email {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		max-width: 12rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (min-width: 768px) {
		.app-header__inner {
			max-width: var(--content-width-wide);
		}
	}
</style>
