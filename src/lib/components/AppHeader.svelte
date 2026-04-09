<script lang="ts">
	import { get } from 'svelte/store';
	import { getSupabase } from '$lib/supabase';
	import { authStore, isAnonymousOrSignedOut, signedInEmail } from '$lib/stores/auth';
	import { mobileMenuOpen } from '$lib/stores/mobileMenu';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import { recommendationsCountStore } from '$lib/stores/recommendationsCount';
	import AuthModal from '$lib/components/AuthModal.svelte';
	import { UserRound } from 'lucide-svelte';
	import { t } from '$lib/copy';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	interface Props {
		onOpenBugReport: () => void;
	}

	let { onOpenBugReport }: Props = $props();

	let authModalOpen = $state(false);
	let authModalInitialTab = $state<'signin' | 'signup'>('signin');
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

	function openBugReportFromMenu() {
		closeMobileMenu();
		onOpenBugReport();
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
		<div class="app-header__start">
			<a
				href="/"
				class="app-header__logo"
				aria-label={t('shared.header.homeAriaLabel')}
			>
				<!-- Logo image can replace .app-header__logo-text; use alt={t('shared.header.logoAlt')} -->
				<span class="app-header__logo-text">{t('shared.header.siteName')}</span>
			</a>
		</div>

		<nav class="app-header__nav" aria-label={t('shared.header.mainNavigation')}>
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
					aria-haspopup="menu"
					aria-controls="app-header-account-menu"
					aria-label={t('shared.header.account')}
					bind:this={accountTriggerEl}
					onclick={toggleAccountDropdown}
				>
					<UserRound class="app-header__account-icon" size={20} aria-hidden="true" />
				</button>
				<div
					id="app-header-account-menu"
					class="app-header__account-panel"
					role="menu"
					hidden={!accountDropdownOpen}
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
			</div>

			<button
				type="button"
				class="app-header__menu-toggle"
				aria-expanded={$mobileMenuOpen}
				aria-controls="app-header-mobile-menu"
				onclick={toggleMobileMenu}
			>
				{t('shared.header.menu')}
			</button>
		</div>
	</div>

	{#if $mobileMenuOpen}
		<div
			id="app-header-mobile-menu"
			class="app-header__mobile-menu"
			role="dialog"
			aria-modal="true"
			aria-label={t('shared.header.mobileMenuLabel')}
			bind:this={mobileMenuEl}
		>
			<div class="app-header__mobile-menu-inner">
				<a
					href="/"
					class="app-header__logo"
					aria-label={t('shared.header.homeAriaLabel')}
					onclick={closeMobileMenu}
				>
					<span class="app-header__logo-text">{t('shared.header.siteName')}</span>
				</a>
				<nav class="app-header__mobile-nav" aria-label={t('shared.header.mainNavigation')}>
					{#if !isLandingPage && !isRatePage}
						<a href="/rate" class="app-header__cta app-header__mobile-menu-cta" onclick={closeMobileMenu}>
							{t('shared.header.rateBooks')}
						</a>
					{/if}
					<a href="/rated" class="app-header__nav-link" onclick={closeMobileMenu}>
						{t('shared.header.ratedBooks')}<span class="app-header__nav-count" aria-label="{ratedCount} rated">({ratedCount})</span>
					</a>
					<a href="/bookmarks" class="app-header__nav-link" onclick={closeMobileMenu}>
						{t('shared.header.bookmarks')}{#if bookmarkCount > 0}
							<span class="app-header__nav-count" aria-label="{bookmarkCount} bookmarked">({bookmarkCount})</span>
						{/if}
					</a>
					<a href="/rate/recommendations" class="app-header__nav-link" onclick={closeMobileMenu}>
						{t('shared.header.myRecommendations')}<span
							class="app-header__nav-count"
							aria-label="{recommendationsCount} recommendations">({recommendationsCount})</span>
					</a>
				</nav>
				<div class="app-header__mobile-account">
					{#if showAuthActions}
						<button type="button" class="app-header__account-item" onclick={() => openAuthModal('signup')}>
							{t('shared.authModal.createAccount')}
						</button>
						<button type="button" class="app-header__account-item" onclick={() => openAuthModal('signin')}>
							{t('shared.authModal.signIn')}
						</button>
					{:else if email}
						<div class="app-header__account-email" role="presentation">{email}</div>
						<button type="button" class="app-header__account-item" onclick={handleSignOut}>
							{t('shared.header.signOut')}
						</button>
					{/if}
				</div>
				<div class="app-header__mobile-footer">
					<a href="/faq" class="app-header__nav-link" onclick={closeMobileMenu}>{t('shared.footer.faq')}</a>
					<button
						type="button"
						class="app-header__nav-link"
						aria-label={t('shared.bugModal.reportBugAriaLabel')}
						onclick={openBugReportFromMenu}
					>
						{t('shared.footer.reportBug')}
					</button>
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

<style>
	.app-header {
		background: var(--color-bg);
		position: relative;
	}
	.app-header__inner {
		max-width: var(--content-width-narrow);
		margin: 0 auto;
		padding: var(--space-3) var(--space-4);
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-height: 3.25rem;
	}
	.app-header__start {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
		min-width: 0;
	}
	.app-header__logo {
		display: inline-flex;
		align-items: center;
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: 600;
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text);
		text-decoration: none;
		white-space: nowrap;
		border-radius: var(--radius);
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
		transition: color 0.15s ease, background 0.15s ease;
	}
	.app-header__logo:hover {
		color: var(--color-accent);
		background: var(--color-bg-muted);
	}
	.app-header__logo:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.app-header__logo-text {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 12rem;
	}
	.app-header__nav {
		display: none;
		align-items: center;
		gap: var(--space-2);
		flex: 1 1 auto;
		min-width: 0;
		justify-content: flex-start;
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
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
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
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
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
	.app-header__account-panel[hidden] {
		display: none;
	}
	.app-header__menu-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
		text-decoration: none;
		white-space: nowrap;
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
		border: none;
		border-radius: var(--radius);
		background: transparent;
		cursor: pointer;
		transition: color 0.15s ease, background 0.15s ease;
	}
	.app-header__menu-toggle:hover {
		color: var(--color-text);
		background: var(--color-bg-muted);
	}
	.app-header__menu-toggle:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.app-header__account {
		position: relative;
	}
	.app-header__account-trigger {
		display: none;
		align-items: center;
		justify-content: center;
		min-height: auto;
		min-width: auto;
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
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
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
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
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
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
	.app-header__mobile-menu {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		width: 100%;
		max-width: 100vw;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
		border: none;
		/* Above rate page fixed bottom bar (z-index 100); below modal overlays / ratings drawer (200+) */
		z-index: 180;
		overflow: auto;
		padding: var(--space-6) var(--space-4);
		box-shadow: var(--shadow-panel-edge);
	}
	.app-header__mobile-menu-inner {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		min-height: 0;
	}
	.app-header__mobile-menu-cta {
		display: block;
		text-align: center;
	}
	.app-header__mobile-menu button.app-header__nav-link {
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}
	.app-header__mobile-nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.app-header__mobile-account {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	.app-header__mobile-footer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-4);
		margin-top: auto;
		border-top: 1px solid var(--color-border);
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
		border-radius: var(--radius);
		cursor: pointer;
		color: var(--color-text);
	}
	.app-header__mobile-close:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
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
		.app-header__menu-toggle {
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
