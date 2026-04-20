<script lang="ts">
	import { get } from 'svelte/store';
	import { getSupabase } from '$lib/supabase';
	import { authStore, isAnonymousOrSignedOut, signedInEmail } from '$lib/stores/auth';
	import { mobileMenuOpen } from '$lib/stores/mobileMenu';
	import { recommendationsCountStore } from '$lib/stores/recommendationsCount';
	import AuthModal from '$lib/components/AuthModal.svelte';
	import AppHeaderMobileMenuAction from '$lib/components/AppHeaderMobileMenuAction.svelte';
	import { UserRound } from 'lucide-svelte';
	import { t } from '$lib/copy';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import homeLogo from '$lib/assets/unread-logo.svg';

	function isNavHrefActive(href: string, pathname: string): boolean {
		if (href === '/rate') return pathname === '/rate';
		if (href === '/rate/recommendations') return pathname.startsWith('/rate/recommendations');
		if (href === '/my-bookshelf') return pathname === '/my-bookshelf';
		return false;
	}

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
	let email = $derived($signedInEmail);
	let pathname = $derived($page.url.pathname);
	/** Signed-in (non-anonymous) users always see primary nav; anonymous users only when they already have recommendations. */
	let showMainNav = $derived(!$isAnonymousOrSignedOut || $recommendationsCountStore > 0);
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
				<img
					class="app-header__logo-img"
					src={homeLogo}
					alt=""
					width="55"
					height="36"
					decoding="async"
					aria-hidden="true"
				/>
			</a>
		</div>

		{#if showMainNav}
			<nav class="app-header__nav" aria-label={t('shared.header.mainNavigation')}>
				<a
					href="/rate"
					class="chrome-nav-link"
					aria-current={isNavHrefActive('/rate', pathname) ? 'page' : undefined}
				>
					{t('shared.header.browse')}
				</a>
				<a
					href="/my-bookshelf"
					class="chrome-nav-link"
					aria-current={isNavHrefActive('/my-bookshelf', pathname) ? 'page' : undefined}
				>
					{t('shared.header.myBookshelf')}
				</a>
				<a
					href="/rate/recommendations"
					class="chrome-nav-link"
					aria-current={isNavHrefActive('/rate/recommendations', pathname) ? 'page' : undefined}
				>
					{t('shared.header.myRecommendations')}
				</a>
			</nav>
		{/if}

		<div class="app-header__right">
			<div class="app-header__account" data-state={accountDropdownOpen ? 'open' : 'closed'}>
				{#if showAuthActions}
					<div class="app-header__auth-actions">
						<button
							type="button"
							class="btn btn--tertiary btn--compact"
							onclick={() => openAuthModal('signin')}
						>
							{t('shared.authModal.signIn')}
						</button>
						<button
							type="button"
							class="btn btn--primary btn--compact"
							onclick={() => openAuthModal('signup')}
						>
							{t('shared.authModal.createAccount')}
						</button>
					</div>
				{:else}
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
						{#if email}
							<div class="app-header__account-email" role="presentation">{email}</div>
							<button type="button" role="menuitem" class="app-header__account-item" onclick={handleSignOut}>
								{t('shared.header.signOut')}
							</button>
						{/if}
					</div>
				{/if}
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
					<img
						class="app-header__logo-img"
						src={homeLogo}
						alt=""
						width="55"
						height="36"
						decoding="async"
						aria-hidden="true"
					/>
				</a>
				{#if showMainNav}
					<nav class="app-header__mobile-nav" aria-label={t('shared.header.mainNavigation')}>
						<a
							href="/rate"
							class="chrome-nav-link"
							aria-current={isNavHrefActive('/rate', pathname) ? 'page' : undefined}
							onclick={closeMobileMenu}
						>
							{t('shared.header.browse')}
						</a>
						<a
							href="/my-bookshelf"
							class="chrome-nav-link"
							aria-current={isNavHrefActive('/my-bookshelf', pathname) ? 'page' : undefined}
							onclick={closeMobileMenu}
						>
							{t('shared.header.myBookshelf')}
						</a>
						<a
							href="/rate/recommendations"
							class="chrome-nav-link"
							aria-current={isNavHrefActive('/rate/recommendations', pathname) ? 'page' : undefined}
							onclick={closeMobileMenu}
						>
							{t('shared.header.myRecommendations')}
						</a>
					</nav>
				{/if}
				<div class="app-header__mobile-account">
					{#if showAuthActions}
						<button type="button" class="app-header__account-item" onclick={() => openAuthModal('signin')}>
							{t('shared.authModal.signIn')}
						</button>
						<button type="button" class="app-header__account-item" onclick={() => openAuthModal('signup')}>
							{t('shared.authModal.createAccount')}
						</button>
					{:else if email}
						<div class="app-header__account-email" role="presentation">{email}</div>
						<button type="button" class="app-header__account-item" onclick={handleSignOut}>
							{t('shared.header.signOut')}
						</button>
					{/if}
				</div>
				<div class="app-header__mobile-footer">
					<AppHeaderMobileMenuAction href="/faq" onclick={closeMobileMenu}>
						{t('shared.footer.faq')}
					</AppHeaderMobileMenuAction>
					<AppHeaderMobileMenuAction
						onclick={openBugReportFromMenu}
						aria-label={t('shared.bugModal.reportBugAriaLabel')}
					>
						{t('shared.footer.reportBug')}
					</AppHeaderMobileMenuAction>
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
		text-decoration: none;
		border-radius: var(--radius-pill);
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
		transition: background 0.15s ease;
	}
	.app-header__logo:hover {
		background: var(--color-interactive-hover-subtle);
	}
	.app-header__logo:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.app-header__logo-img {
		display: block;
		height: 1.625rem;
		width: auto;
		flex-shrink: 0;
	}
	.app-header__nav {
		display: none;
		align-items: center;
		gap: var(--space-2);
		flex: 1 1 auto;
		min-width: 0;
		justify-content: flex-start;
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
		border-radius: var(--radius-pill);
		background: transparent;
		cursor: pointer;
		transition: color 0.15s ease, background 0.15s ease;
	}
	.app-header__menu-toggle:hover {
		color: var(--color-text);
		background: var(--color-interactive-hover-subtle);
	}
	.app-header__menu-toggle:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.app-header__account {
		position: relative;
	}
	.app-header__auth-actions {
		display: none;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	/** Match `.chrome-nav-link` chip size (shared `--chrome-menu-padding-*`, no fixed min-height). */
	.app-header__auth-actions :global(.btn.btn--compact) {
		min-height: auto;
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
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
		border-radius: var(--radius-pill);
		color: var(--color-button-tertiary-text);
		cursor: pointer;
		transition: color 0.15s ease, background 0.15s ease;
	}
	.app-header__account-trigger:hover {
		background: var(--color-button-tertiary-hover-bg);
		color: var(--color-text);
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
		border-radius: var(--radius-pill);
		cursor: pointer;
	}
	.app-header__account-item:hover {
		background: var(--color-interactive-hover-subtle);
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
		align-items: flex-start;
		gap: var(--space-6);
		min-height: 0;
		width: 100%;
	}
	.app-header__mobile-nav {
		display: flex;
		flex-direction: column;
		align-self: stretch;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.app-header__mobile-account {
		display: flex;
		flex-direction: column;
		align-self: stretch;
		align-items: flex-start;
		gap: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	.app-header__mobile-account .app-header__account-item {
		width: auto;
		max-width: 100%;
	}
	.app-header__mobile-account .app-header__account-email {
		align-self: stretch;
		width: 100%;
		max-width: 100%;
		box-sizing: border-box;
	}
	.app-header__mobile-footer {
		display: flex;
		flex-direction: column;
		align-self: stretch;
		align-items: flex-start;
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
		border-radius: var(--radius-pill);
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
			padding: var(--space-3) var(--space-4);
		}
		.app-header__menu-toggle {
			display: none;
		}
		.app-header__nav {
			display: flex;
			flex: 0 1 auto;
			min-width: 0;
			gap: var(--space-2);
		}
		.app-header__auth-actions {
			display: flex;
		}
		.app-header__account-trigger {
			display: flex;
		}
	}
</style>
