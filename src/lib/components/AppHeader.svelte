<script lang="ts">
	import { get } from 'svelte/store';
	import { getSupabase } from '$lib/supabase';
	import { authStore, isAnonymousOrSignedOut, signedInEmail } from '$lib/stores/auth';
	import { mobileMenuOpen } from '$lib/stores/mobileMenu';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import { recommendationsCountStore } from '$lib/stores/recommendationsCount';
	import AuthModal from '$lib/components/AuthModal.svelte';
	import BugReportModal from '$lib/components/BugReportModal.svelte';
	import Button from '$lib/components/Button.svelte';
	import { UserRound } from 'lucide-svelte';
	import { t } from '$lib/copy';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let authModalOpen = $state(false);
	let authModalInitialTab = $state<'signin' | 'signup'>('signin');
	let bugModalOpen = $state(false);
	let accountDropdownOpen = $state(false);
	let accountTriggerEl = $state<HTMLButtonElement | null>(null);
	let accountPanelEl = $state<HTMLDivElement | null>(null);
	let mobileMenuEl = $state<HTMLDivElement | null>(null);

	let showAuthActions = $derived($isAnonymousOrSignedOut);
	let isLandingPage = $derived($page.url.pathname === '/');
	let isRatePage = $derived($page.url.pathname === '/rate');
	let email = $derived($signedInEmail);
	let bookmarkCount = $derived($planToReadStore.size ?? 0);
	let ratedCount = $derived($ratingsStore.size ?? 0);
	let recommendationsCount = $derived($recommendationsCountStore);

	function openAuthModal(tab: 'signin' | 'signup' = 'signin') {
		authModalInitialTab = tab;
		authModalOpen = true;
		closeAccountDropdown();
		closeMobileMenu();
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
		closeAccountDropdown();
		closeMobileMenu();
	}

	function toggleAccountDropdown() {
		accountDropdownOpen = !accountDropdownOpen;
		if (accountDropdownOpen) mobileMenuOpen.set(false);
	}

	function closeAccountDropdown() {
		accountDropdownOpen = false;
	}

	function toggleMobileMenu() {
		mobileMenuOpen.update((v) => !v);
		if (get(mobileMenuOpen)) accountDropdownOpen = false;
	}

	function closeMobileMenu() {
		mobileMenuOpen.set(false);
	}

	function handleClickOutsideAccount(e: MouseEvent) {
		if (
			accountDropdownOpen &&
			accountPanelEl &&
			accountTriggerEl &&
			!accountPanelEl.contains(e.target as Node) &&
			!accountTriggerEl.contains(e.target as Node)
		) {
			closeAccountDropdown();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			closeAccountDropdown();
			closeMobileMenu();
		}
	}

	onMount(() => {
		const mq = window.matchMedia('(min-width: 768px)');
		const closeMenuIfDesktop = () => {
			if (mq.matches) mobileMenuOpen.set(false);
		};
		mq.addEventListener('change', closeMenuIfDesktop);

		document.addEventListener('click', handleClickOutsideAccount);
		document.addEventListener('keydown', handleKeydown);
		return () => {
			mq.removeEventListener('change', closeMenuIfDesktop);
			document.removeEventListener('click', handleClickOutsideAccount);
			document.removeEventListener('keydown', handleKeydown);
		};
	});
</script>

<header class="app-header">
	<div class="app-header__inner">
		<div class="app-header__left">
			<button
				type="button"
				class="app-header__hamburger"
				aria-expanded={$mobileMenuOpen}
				aria-label={t('shared.header.openMenu')}
				aria-controls="app-header-mobile-menu"
				onclick={toggleMobileMenu}
			>
				<span class="app-header__hamburger-bar"></span>
				<span class="app-header__hamburger-bar"></span>
				<span class="app-header__hamburger-bar"></span>
			</button>
		</div>

		<nav class="app-header__nav" aria-label="Main">
			{#if !isLandingPage && !isRatePage}
				<a href="/rate" class="app-header__cta">{t('shared.header.rateBooks')}</a>
			{/if}
			<a href="/rated" class="app-header__nav-link">
				{t('shared.header.ratedBooks')}<span class="app-header__nav-count" aria-label="{ratedCount} rated">({ratedCount})</span>
			</a>
			<a href="/bookmarks" class="app-header__nav-link">
				{t('shared.header.bookmarks')}{#if bookmarkCount > 0}
					<span class="app-header__nav-count" aria-label="{bookmarkCount} bookmarked">({bookmarkCount})</span>
				{/if}
			</a>
			<a href="/rate/recommendations" class="app-header__nav-link">
				{t('shared.header.myRecommendations')}<span class="app-header__nav-count" aria-label="{recommendationsCount} recommendations">({recommendationsCount})</span>
			</a>
		</nav>

		<div class="app-header__right">
			<div class="app-header__account" data-state={accountDropdownOpen ? 'open' : 'closed'}>
				<button
					type="button"
					class="app-header__account-trigger"
					aria-expanded={accountDropdownOpen}
					aria-haspopup="true"
					aria-label={t('shared.header.account')}
					bind:this={accountTriggerEl}
					onclick={toggleAccountDropdown}
				>
					<UserRound class="app-header__account-icon" size={20} aria-hidden="true" />
				</button>
				{#if accountDropdownOpen}
					<div
						class="app-header__account-panel"
						role="menu"
						bind:this={accountPanelEl}
					>
						{#if showAuthActions}
							<button
								type="button"
								role="menuitem"
								class="app-header__account-item"
								onclick={() => openAuthModal('signup')}
							>
								{t('shared.authModal.createAccount')}
							</button>
							<button
								type="button"
								role="menuitem"
								class="app-header__account-item"
								onclick={() => openAuthModal('signin')}
							>
								{t('shared.authModal.signIn')}
							</button>
						{:else if email}
							<div class="app-header__account-email" role="presentation">{email}</div>
							<button type="button" role="menuitem" class="app-header__account-item" onclick={handleSignOut}>
								{t('shared.header.signOut')}
							</button>
						{/if}
					</div>
				{/if}
			</div>

			<Button
				variant="tertiary"
				compact
				class="app-header__bug"
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
	</div>

	{#if $mobileMenuOpen}
		<div
			id="app-header-mobile-menu"
			class="app-header__mobile-menu"
			role="dialog"
			aria-label="Menu"
			bind:this={mobileMenuEl}
		>
			<div class="app-header__mobile-menu-inner">
			<nav class="app-header__mobile-nav" aria-label="Main">
				{#if !isLandingPage && !isRatePage}
					<a href="/rate" class="app-header__mobile-cta" onclick={closeMobileMenu}>{t('shared.header.rateBooks')}</a>
				{/if}
					<a href="/rated" class="app-header__mobile-link" onclick={closeMobileMenu}>
						{t('shared.header.ratedBooks')} ({ratedCount})
					</a>
					<a href="/bookmarks" class="app-header__mobile-link" onclick={closeMobileMenu}>
						{t('shared.header.bookmarks')}{#if bookmarkCount > 0} ({bookmarkCount}){/if}
					</a>
					<a href="/rate/recommendations" class="app-header__mobile-link" onclick={closeMobileMenu}>
						{t('shared.header.myRecommendations')} ({recommendationsCount})
					</a>
				</nav>
				<div class="app-header__mobile-account">
					{#if showAuthActions}
						<button type="button" class="app-header__mobile-btn" onclick={() => openAuthModal('signup')}>
							{t('shared.authModal.createAccount')}
						</button>
						<button
							type="button"
							class="app-header__mobile-btn app-header__mobile-btn--primary"
							onclick={() => openAuthModal('signin')}
						>
							{t('shared.authModal.signIn')}
						</button>
					{:else if email}
						<span class="app-header__mobile-email" title={email}>{email}</span>
						<button type="button" class="app-header__mobile-btn" onclick={handleSignOut}>{t('shared.header.signOut')}</button>
					{/if}
				</div>
			</div>
			<button
				type="button"
				class="app-header__mobile-close"
				aria-label={t('shared.header.closeMenu')}
				onclick={closeMobileMenu}
			>
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path d="M18 6 6 18M6 6l12 12" />
				</svg>
			</button>
		</div>
		<div class="app-header__mobile-backdrop" role="presentation" onclick={closeMobileMenu} aria-hidden="true"></div>
	{/if}
</header>

<AuthModal open={authModalOpen} onClose={closeAuthModal} initialTab={authModalInitialTab} />
<BugReportModal open={bugModalOpen} onClose={closeBugModal} />

<style>
	.app-header {
		background: var(--color-card-bg);
		border-bottom: 1px solid var(--color-border);
		position: relative;
		box-shadow: var(--shadow-header-line);
	}
	.app-header__inner {
		max-width: var(--content-width-narrow);
		margin: 0 auto;
		padding: var(--space-3) var(--space-4);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		min-height: 3.25rem;
	}
	.app-header__left {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}
	.app-header__nav {
		display: none;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}
	.app-header__cta {
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-bg);
		text-decoration: none;
		white-space: nowrap;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-pill);
		background: var(--color-text);
		border: 1px solid var(--color-text);
		transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
	}
	.app-header__cta:hover {
		opacity: 0.9;
		background: var(--color-text);
		color: var(--color-bg);
	}
	.app-header__nav-link {
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
		text-decoration: none;
		white-space: nowrap;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius);
		transition: color 0.15s ease, background 0.15s ease;
	}
	.app-header__nav-link:hover {
		color: var(--color-text);
		background: var(--color-bg-muted);
	}
	.app-header__nav-count {
		color: var(--color-text-muted);
		font-weight: var(--font-weight-normal);
	}
	.app-header__right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-left: auto;
		flex-shrink: 0;
	}
	:global(.app-header__bug) {
		color: var(--color-text-muted);
	}
	:global(.app-header__bug:hover) {
		color: var(--color-text);
	}
	.app-header__account {
		position: relative;
	}
	.app-header__account-trigger {
		display: none;
		align-items: center;
		justify-content: center;
		min-height: 2rem;
		min-width: 2rem;
		padding: var(--space-2);
		background: var(--color-button-tertiary-bg);
		border: none;
		border-radius: var(--radius);
		color: var(--color-button-tertiary-text);
		cursor: pointer;
		transition: color 0.15s ease, background 0.15s ease;
	}
	.app-header__account-trigger:hover {
		background: var(--color-button-tertiary-hover-bg);
		color: var(--color-button-tertiary-text);
	}
	:global(.app-header__account-icon) {
		flex-shrink: 0;
	}
	.app-header__account-panel {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: var(--space-1);
		min-width: 12rem;
		padding: var(--space-2);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-lg);
		z-index: 60;
	}
	.app-header__account-item {
		display: block;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		text-align: left;
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.app-header__account-item:hover {
		background: var(--color-bg-muted);
	}
	.app-header__account-email {
		padding: var(--space-2) var(--space-3);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: var(--space-1);
	}
	.app-header__mobile-cta {
		display: block;
		text-align: center;
		padding: var(--space-1) var(--space-3);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-bg);
		text-decoration: none;
		border-radius: var(--radius-pill);
		background: var(--color-text);
		border: 1px solid var(--color-text);
		transition: opacity 0.15s ease;
	}
	.app-header__mobile-cta:hover {
		opacity: 0.9;
		color: var(--color-bg);
	}
	.app-header__hamburger {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		width: var(--min-tap);
		height: var(--min-tap);
		padding: var(--space-2);
		background: transparent;
		border: none;
		cursor: pointer;
		border-radius: var(--radius);
	}
	.app-header__hamburger:hover {
		background: var(--color-bg-muted);
	}
	.app-header__hamburger-bar {
		display: block;
		width: 20px;
		height: 2px;
		background: var(--color-text);
		border-radius: 1px;
	}
	.app-header__mobile-menu {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		width: 100%;
		max-width: 100vw;
		min-height: 100dvh;
		background: var(--color-card-bg);
		border: none;
		/* Above rate page fixed bottom bar (z-index 100); below modal overlays / ratings drawer (200+) */
		z-index: 180;
		overflow: auto;
		padding: var(--space-6) var(--space-4);
		box-shadow: var(--shadow-panel-edge);
	}
	.app-header__mobile-menu-inner {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.app-header__mobile-nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.app-header__mobile-link {
		font-family: var(--typ-interactive-1-font-family);
		font-size: var(--typ-interactive-1-font-size);
		font-weight: var(--typ-interactive-1-font-weight);
		line-height: var(--typ-interactive-1-line-height);
		letter-spacing: var(--typ-interactive-1-letter-spacing);
		color: var(--color-text);
		text-decoration: none;
		padding: var(--space-3);
		border-radius: var(--radius);
	}
	.app-header__mobile-link:hover {
		background: var(--color-bg-muted);
		color: var(--color-accent);
	}
	.app-header__mobile-account {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	.app-header__mobile-email {
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		padding: var(--space-2) 0;
	}
	.app-header__mobile-btn {
		padding: var(--space-3) var(--space-4);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		background: var(--color-bg-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		color: var(--color-text);
		cursor: pointer;
		text-align: left;
	}
	.app-header__mobile-btn--primary {
		background: var(--color-button-primary-bg);
		border-color: var(--color-button-primary-bg);
		color: var(--color-button-primary-text);
	}
	.app-header__mobile-close {
		position: absolute;
		top: var(--space-4);
		right: var(--space-4);
		width: var(--min-tap);
		height: var(--min-tap);
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-text);
	}
	.app-header__mobile-backdrop {
		position: fixed;
		inset: 0;
		background: var(--color-overlay-scrim-soft);
		z-index: 179;
	}

	@media (min-width: 768px) {
		.app-header__inner {
			max-width: var(--content-width-wide);
			padding: var(--space-3) var(--space-5);
		}
		.app-header__left {
			display: none;
		}
		.app-header__nav {
			display: flex;
			gap: var(--space-2);
		}
		.app-header__account-trigger {
			display: flex;
		}
	}
</style>
