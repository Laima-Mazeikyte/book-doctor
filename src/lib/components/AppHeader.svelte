<script lang="ts">
	import { getSupabase } from '$lib/supabase';
	import { authStore, isAnonymousOrSignedOut, signedInEmail } from '$lib/stores/auth';
	import AuthModal from '$lib/components/AuthModal.svelte';
	import BugReportModal from '$lib/components/BugReportModal.svelte';
	import Button from '$lib/components/Button.svelte';
	import { t } from '$lib/copy';

	let authModalOpen = $state(false);
	let bugModalOpen = $state(false);
	let showAuthActions = $derived($isAnonymousOrSignedOut);
	let email = $derived($signedInEmail);

	function openAuthModal() {
		authModalOpen = true;
	}

	function closeAuthModal() {
		authModalOpen = false;
	}

	function openBugModal() {
		bugModalOpen = true;
	}

	function closeBugModal() {
		bugModalOpen = false;
	}

	function handleSignOut() {
		getSupabase()?.auth.signOut();
	}
</script>

<header class="app-header">
	<div class="app-header__inner">
		<div class="app-header__left">
			<Button
				variant="tertiary"
				compact
				aria-label={t('shared.bugModal.reportBugAriaLabel')}
				onclick={openBugModal}
			>
				{#snippet icon()}
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="m8 2 1.88 1.88" />
						<path d="M14.12 3.88 16 2" />
						<path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
						<path d="M12 20c-3.31 0-6-2.69-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.31-2.69 6-6 6" />
						<path d="M12 20v-9" />
						<path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
						<path d="M6 13H2" />
						<path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
						<path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
						<path d="M22 13h-4" />
						<path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
					</svg>
				{/snippet}
			</Button>
		</div>
		{#if showAuthActions}
			<div class="app-header__auth">
				<Button variant="tertiary" compact onclick={openAuthModal}>{t('shared.authModal.createAccount')}</Button>
				<Button variant="secondary" compact onclick={openAuthModal}>{t('shared.authModal.signIn')}</Button>
			</div>
		{:else if email}
			<div class="app-header__auth app-header__auth--signed-in">
				<Button href="/rate/recommendations" variant="tertiary" compact>{t('shared.header.myRecommendations')}</Button>
				<span class="app-header__email" title={email}>{email}</span>
				<Button variant="tertiary" compact onclick={handleSignOut}>{t('shared.header.signOut')}</Button>
			</div>
		{/if}
	</div>
</header>

<AuthModal open={authModalOpen} onClose={closeAuthModal} />
<BugReportModal open={bugModalOpen} onClose={closeBugModal} />

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
	.app-header__left {
		display: flex;
		align-items: center;
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
