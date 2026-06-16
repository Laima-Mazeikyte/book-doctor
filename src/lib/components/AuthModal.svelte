<script lang="ts">
	import { tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import Button from '$lib/components/Button.svelte';
	import { getSupabase } from '$lib/supabase';
	import { t } from '$lib/copy';
	import { Eye, EyeOff } from 'lucide-svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		/** Initial tab when opening: 'signin' | 'signup' */
		initialTab?: 'signin' | 'signup';
		/** Clears in-memory draft when the route changes (typically pathname). */
		draftResetKey?: string;
		/** Element to restore focus to when the modal closes (e.g. header auth opener). */
		restoreFocusTarget?: HTMLElement | null;
	}

	let {
		open,
		onClose,
		initialTab = 'signin',
		draftResetKey = '',
		restoreFocusTarget = null
	}: Props = $props();

	let tab = $state<'signin' | 'signup' | 'forgot'>('signin');
	let email = $state('');
	let signInPassword = $state('');
	let signUpPassword = $state('');
	let revealSignInPassword = $state(false);
	let revealSignUpPassword = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let successMessage = $state<string | null>(null);
	let panelEl = $state<HTMLDivElement | null>(null);
	let lastDraftResetKey: string | null = null;
	let authRequestId = 0;
	let previouslyFocusedEl: HTMLElement | null = null;

	const panelId = 'auth-modal-panel';
	const titleId = 'auth-modal-title';

	function isFocusableVisible(el: HTMLElement): boolean {
		if (el.hasAttribute('disabled')) return false;
		if (el.getAttribute('aria-hidden') === 'true') return false;
		if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
		const style = window.getComputedStyle(el);
		if (style.display === 'none' || style.visibility === 'hidden') return false;
		const rects = el.getClientRects();
		return rects.length > 0 || el === document.activeElement;
	}

	function getFocusableElements(container: HTMLElement): HTMLElement[] {
		return Array.from(
			container.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		).filter(isFocusableVisible);
	}

	function beginAuthRequest() {
		loading = true;
		return ++authRequestId;
	}

	function isCurrentAuthRequest(id: number) {
		return id === authRequestId;
	}

	function finishAuthRequest(id: number) {
		if (isCurrentAuthRequest(id)) loading = false;
	}

	function restorePreviousFocus() {
		queueMicrotask(() => {
			if (previouslyFocusedEl?.isConnected) {
				previouslyFocusedEl.focus({ preventScroll: true });
			}
			previouslyFocusedEl = null;
		});
	}

	function clearDraft() {
		email = '';
		signInPassword = '';
		signUpPassword = '';
	}

	function clearTransientState() {
		error = null;
		successMessage = null;
		revealSignInPassword = false;
		revealSignUpPassword = false;
	}

	function closeAfterAuthSuccess() {
		clearDraft();
		clearTransientState();
		onClose();
		restorePreviousFocus();
	}

	/** Dismiss modal but keep in-memory draft for reopen on the same route. */
	function closeModal() {
		if (loading) return;
		clearTransientState();
		onClose();
		restorePreviousFocus();
	}

	function handleModalKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeModal();
			return;
		}
		if (e.key !== 'Tab' || !panelEl) return;
		const focusable = getFocusableElements(panelEl);
		if (focusable.length === 0) {
			e.preventDefault();
			panelEl.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;
		if (e.shiftKey) {
			if (active === first || !panelEl.contains(active)) {
				e.preventDefault();
				last.focus();
			}
		} else if (active === last || !panelEl.contains(active)) {
			e.preventDefault();
			first.focus();
		}
	}

	function portal(node: HTMLElement, target: HTMLElement = document.body) {
		target.appendChild(node);
		return {
			destroy() {
				node.parentNode?.removeChild(node);
			}
		};
	}

	function handleOverlayClick(e: MouseEvent) {
		if (loading) return;
		if (e.target === e.currentTarget) closeModal();
	}

	$effect(() => {
		const key = draftResetKey;
		if (lastDraftResetKey === null) {
			lastDraftResetKey = key;
			return;
		}
		if (key !== lastDraftResetKey) {
			lastDraftResetKey = key;
			clearDraft();
			clearTransientState();
		}
	});

	$effect(() => {
		if (open) {
			tab = initialTab;
			clearTransientState();
			previouslyFocusedEl =
				restoreFocusTarget ??
				(document.activeElement instanceof HTMLElement ? document.activeElement : null);
		}
	});

	$effect(() => {
		const activeTab = tab;
		if (!open || !panelEl) return;
		tick().then(() => {
			if (!open || !panelEl || tab !== activeTab) return;
			const target =
				panelEl.querySelector<HTMLInputElement>('input[type="email"]') ??
				getFocusableElements(panelEl)[0] ??
				panelEl;
			target.focus({ preventScroll: true });
		});
	});

	$effect(() => {
		if (!open || !panelEl) return;
		function keepFocusInside(e: FocusEvent) {
			if (panelEl && e.target instanceof Node && !panelEl.contains(e.target)) {
				const first = getFocusableElements(panelEl)[0];
				if (first) first.focus();
				else panelEl.focus();
			}
		}
		document.addEventListener('focusin', keepFocusInside);
		return () => document.removeEventListener('focusin', keepFocusInside);
	});

	$effect(() => {
		if (open) {
			const prev = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = prev;
			};
		}
	});

	async function handleForgotPassword(e: SubmitEvent) {
		e.preventDefault();
		if (loading) return;
		error = null;
		successMessage = null;
		const supabase = getSupabase();
		if (!supabase) {
			error = t('shared.authModal.errorUnableToConnect');
			return;
		}
		const trimmed = email.trim();
		if (!trimmed) {
			error = t('shared.authModal.errorEmailRequired');
			return;
		}

		const requestId = beginAuthRequest();
		try {
			const origin = typeof window !== 'undefined' ? window.location.origin : '';
			const resetOptions = { redirectTo: `${origin}/auth/reset-password` };
			const { error: err } = await supabase.auth.resetPasswordForEmail(trimmed, resetOptions);
			if (!isCurrentAuthRequest(requestId)) return;
			if (err) {
				error = err.message ?? t('shared.authModal.errorResetEmailFailed');
				return;
			}
			successMessage = t('shared.authModal.successResetEmailSent');
		} finally {
			finishAuthRequest(requestId);
		}
	}

	async function handleSignIn(e: SubmitEvent) {
		e.preventDefault();
		if (loading) return;
		error = null;
		successMessage = null;
		const supabase = getSupabase();
		if (!supabase) {
			error = t('shared.authModal.errorUnableToConnect');
			return;
		}

		const requestId = beginAuthRequest();
		try {
			const { error: err } = await supabase.auth.signInWithPassword({
				email,
				password: signInPassword
			});
			if (!isCurrentAuthRequest(requestId)) return;
			if (err) {
				error = err.message ?? t('shared.authModal.errorInvalidCredentials');
				return;
			}
			closeAfterAuthSuccess();
		} finally {
			finishAuthRequest(requestId);
		}
	}

	async function handleSignUp(e: SubmitEvent) {
		e.preventDefault();
		if (loading) return;
		error = null;
		successMessage = null;
		const supabase = getSupabase();
		if (!supabase) {
			error = t('shared.authModal.errorUnableToConnect');
			return;
		}

		const requestId = beginAuthRequest();
		try {
			const {
				data: { session: currentSession }
			} = await supabase.auth.getSession();
			if (!isCurrentAuthRequest(requestId)) return;
			const isAnonymous = currentSession?.user?.is_anonymous === true;
			const anonymousUserId = currentSession?.user?.id ?? null;

			if (isAnonymous && anonymousUserId) {
				const { error: updateErr } = await supabase.auth.updateUser({
					email,
					password: signUpPassword
				});
				if (!isCurrentAuthRequest(requestId)) return;
				if (!updateErr) {
					closeAfterAuthSuccess();
					return;
				}

				const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
					email,
					password: signUpPassword
				});
				if (!isCurrentAuthRequest(requestId)) return;
				if (signUpErr) {
					error = signUpErr.message ?? t('shared.authModal.errorSignUpFailed');
					return;
				}

				const accessToken = signUpData?.session?.access_token;
				if (accessToken) {
					try {
						const base = typeof window !== 'undefined' ? window.location.origin : '';
						const res = await fetch(`${base}/api/migrate-anonymous-data`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								Authorization: `Bearer ${accessToken}`
							},
							body: JSON.stringify({ anonymousUserId })
						});
						if (!isCurrentAuthRequest(requestId)) return;
						if (res.ok) {
							window.dispatchEvent(new CustomEvent('auth:ratings-migrated'));
						} else {
							console.warn('[auth] Migrate anonymous data failed:', res.status, await res.text());
						}
					} catch (migrateErr) {
						console.warn('[auth] Migrate anonymous data request failed', migrateErr);
					}
				}
				if (!isCurrentAuthRequest(requestId)) return;
				closeAfterAuthSuccess();
				return;
			}

			const { error: err } = await supabase.auth.signUp({
				email,
				password: signUpPassword
			});
			if (!isCurrentAuthRequest(requestId)) return;
			if (err) {
				error = err.message ?? t('shared.authModal.errorSignUpFailed');
				return;
			}
			closeAfterAuthSuccess();
		} finally {
			finishAuthRequest(requestId);
		}
	}
</script>

{#if open}
	<div
		use:portal
		id={panelId}
		class="auth-modal-overlay"
		role="dialog"
		aria-modal="true"
		aria-labelledby={titleId}
		tabindex="-1"
		onclick={handleOverlayClick}
		onkeydown={handleModalKeydown}
		transition:fade={{ duration: 150 }}
	>
		<div
			bind:this={panelEl}
			class="auth-modal-panel"
			role="presentation"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<h2 id={titleId} class="auth-modal__sr-only">{t('shared.authModal.dialogAccessibleName')}</h2>

			<div class="auth-modal__header">
				{#if tab === 'forgot'}
					<div class="auth-modal__forgot-header">
						<button
							type="button"
							class="auth-modal__text-btn"
							onclick={() => {
								tab = 'signin';
								error = null;
								successMessage = null;
							}}
						>
							{t('shared.authModal.backToSignIn')}
						</button>
						<p class="auth-modal__forgot-title">{t('shared.authModal.resetPasswordTitle')}</p>
					</div>
				{:else}
					<div class="auth-modal__tabs">
						<button
							type="button"
							class="auth-modal__tab"
							class:auth-modal__tab--active={tab === 'signin'}
							onclick={() => {
								tab = 'signin';
								revealSignUpPassword = false;
								error = null;
								successMessage = null;
							}}
						>
							{t('shared.authModal.signIn')}
						</button>
						<button
							type="button"
							class="auth-modal__tab"
							class:auth-modal__tab--active={tab === 'signup'}
							onclick={() => {
								tab = 'signup';
								revealSignInPassword = false;
								error = null;
								successMessage = null;
							}}
						>
							{t('shared.authModal.createAccount')}
						</button>
					</div>
				{/if}
				<Button
					variant="tertiary"
					compact
					pill
					type="button"
					aria-label={t('shared.authModal.close')}
					disabled={loading}
					onclick={closeModal}
				>
					{#snippet icon()}
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M18 6 6 18M6 6l12 12" />
						</svg>
					{/snippet}
				</Button>
			</div>

			{#if error}
				<p class="auth-modal__error" role="alert">{error}</p>
			{/if}
			{#if successMessage}
				<p class="auth-modal__success" role="status">{successMessage}</p>
			{/if}

			{#if tab === 'forgot'}
				<p class="auth-modal__forgot-lead">{t('shared.authModal.resetPasswordLead')}</p>
				<form class="auth-modal__form" onsubmit={handleForgotPassword}>
					<div class="auth-modal__field">
						<label class="auth-modal__label" for="auth-email-forgot"
							>{t('shared.authModal.email')}</label
						>
						<input
							id="auth-email-forgot"
							type="email"
							class="auth-modal__input"
							placeholder={t('shared.authModal.emailPlaceholder')}
							bind:value={email}
							required
							autocomplete="email"
							disabled={loading}
						/>
					</div>
					<Button type="submit" variant="primary" pill disabled={loading}>
						{loading ? t('shared.authModal.sendingResetLink') : t('shared.authModal.sendResetLink')}
					</Button>
				</form>
			{:else if tab === 'signin'}
				<form class="auth-modal__form" onsubmit={handleSignIn}>
					<div class="auth-modal__field">
						<label class="auth-modal__label" for="auth-email-signin"
							>{t('shared.authModal.email')}</label
						>
						<input
							id="auth-email-signin"
							type="email"
							class="auth-modal__input"
							placeholder={t('shared.authModal.emailPlaceholder')}
							bind:value={email}
							required
							autocomplete="email"
							disabled={loading}
						/>
					</div>
					<div class="auth-modal__field">
						<label class="auth-modal__label" for="auth-password-signin"
							>{t('shared.authModal.password')}</label
						>
						<div class="auth-modal__password-wrap">
							<input
								id="auth-password-signin"
								type={revealSignInPassword ? 'text' : 'password'}
								class="auth-modal__input auth-modal__input--with-toggle"
								bind:value={signInPassword}
								required
								autocomplete="current-password"
								disabled={loading}
							/>
							<button
								type="button"
								class="auth-modal__password-toggle"
								aria-label={revealSignInPassword
									? t('shared.authModal.hidePassword')
									: t('shared.authModal.showPassword')}
								aria-pressed={revealSignInPassword}
								disabled={loading}
								onclick={() => (revealSignInPassword = !revealSignInPassword)}
							>
								{#if revealSignInPassword}
									<EyeOff size={20} aria-hidden="true" />
								{:else}
									<Eye size={20} aria-hidden="true" />
								{/if}
							</button>
						</div>
						<button
							type="button"
							class="auth-modal__text-btn auth-modal__forgot-link"
							disabled={loading}
							onclick={() => {
								tab = 'forgot';
								error = null;
								successMessage = null;
							}}
						>
							{t('shared.authModal.forgotPassword')}
						</button>
					</div>
					<Button type="submit" variant="primary" pill disabled={loading}>
						{loading ? t('shared.authModal.signingIn') : t('shared.authModal.signIn')}
					</Button>
				</form>
			{:else}
				<form class="auth-modal__form" onsubmit={handleSignUp}>
					<div class="auth-modal__field">
						<label class="auth-modal__label" for="auth-email-signup"
							>{t('shared.authModal.email')}</label
						>
						<input
							id="auth-email-signup"
							type="email"
							class="auth-modal__input"
							placeholder={t('shared.authModal.emailPlaceholder')}
							bind:value={email}
							required
							autocomplete="email"
							disabled={loading}
						/>
					</div>
					<div class="auth-modal__field">
						<label class="auth-modal__label" for="auth-password-signup"
							>{t('shared.authModal.password')}</label
						>
						<p id="auth-password-signup-hint" class="auth-modal__hint">
							{t('shared.authModal.passwordRulesSignUp')}
						</p>
						<div class="auth-modal__password-wrap">
							<input
								id="auth-password-signup"
								type={revealSignUpPassword ? 'text' : 'password'}
								class="auth-modal__input auth-modal__input--with-toggle"
								bind:value={signUpPassword}
								required
								minlength="6"
								autocomplete="new-password"
								aria-describedby="auth-password-signup-hint"
								disabled={loading}
							/>
							<button
								type="button"
								class="auth-modal__password-toggle"
								aria-label={revealSignUpPassword
									? t('shared.authModal.hidePassword')
									: t('shared.authModal.showPassword')}
								aria-pressed={revealSignUpPassword}
								disabled={loading}
								onclick={() => (revealSignUpPassword = !revealSignUpPassword)}
							>
								{#if revealSignUpPassword}
									<EyeOff size={20} aria-hidden="true" />
								{:else}
									<Eye size={20} aria-hidden="true" />
								{/if}
							</button>
						</div>
					</div>
					<Button type="submit" variant="primary" pill disabled={loading}>
						{loading ? t('shared.authModal.creatingAccount') : t('shared.authModal.createAccount')}
					</Button>
				</form>
			{/if}
		</div>
	</div>
{/if}

<style>
	.auth-modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: var(--color-overlay-scrim);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-6) clamp(var(--space-12), 10vw, var(--space-24));
		box-sizing: border-box;
	}

	.auth-modal-panel {
		position: relative;
		background: var(--color-card-bg);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		width: 100%;
		max-width: 26rem;
		padding: var(--space-6) var(--space-8);
		text-align: left;
	}

	.auth-modal__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.auth-modal__header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-5);
	}

	.auth-modal__forgot-header {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding-bottom: var(--space-1);
	}

	.auth-modal__forgot-title {
		margin: 0;
		font-family: var(--typ-h3-font-family);
		font-size: var(--typ-h3-font-size);
		font-weight: var(--typ-h3-font-weight);
		line-height: var(--typ-h3-line-height);
		letter-spacing: var(--typ-h3-letter-spacing);
		color: var(--color-text);
	}

	.auth-modal__forgot-lead {
		margin: 0 0 var(--space-4);
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-text-muted);
	}

	.auth-modal__text-btn {
		padding: 0;
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-accent);
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.auth-modal__text-btn:hover:not(:disabled) {
		color: var(--color-text);
	}
	.auth-modal__text-btn:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
		border-radius: var(--radius-pill);
	}
	.auth-modal__text-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.auth-modal__forgot-link {
		align-self: flex-start;
		margin-top: var(--space-2);
		text-decoration: none;
	}
	.auth-modal__forgot-link:hover:not(:disabled),
	.auth-modal__forgot-link:focus-visible {
		text-decoration: underline;
	}

	.auth-modal__header :global(.btn) {
		flex-shrink: 0;
	}

	.auth-modal__tabs {
		display: flex;
		gap: var(--space-1);
		flex-shrink: 0;
		flex-wrap: wrap;
		min-width: 0;
	}

	.auth-modal__tab {
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition:
			color 0.15s ease,
			background 0.15s ease;
	}
	.auth-modal__tab:hover {
		color: var(--color-text);
		background: var(--color-interactive-hover-subtle);
	}
	.auth-modal__tab--active {
		color: var(--color-text);
		font-weight: var(--font-weight-semibold);
		background: var(--color-accent-bg);
	}
	.auth-modal__tab--active:hover {
		color: var(--color-text);
		background: var(--color-interactive-hover-on-accent);
	}
	.auth-modal__tab:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}

	.auth-modal__error {
		margin: 0 0 var(--space-4);
		padding: var(--space-3) var(--space-4);
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		text-align: left;
		color: var(--color-error-text);
		background: var(--color-error-bg);
		border: 1px solid var(--color-error-border);
		border-radius: var(--radius-sm);
	}

	.auth-modal__success {
		margin: 0 0 var(--space-4);
		padding: var(--space-3) var(--space-4);
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		text-align: left;
		color: var(--color-text);
		background: var(--color-accent-bg);
		border-radius: var(--radius-sm);
	}

	.auth-modal__form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.auth-modal__field {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-1);
	}

	.auth-modal__hint {
		margin: 0;
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
	}

	.auth-modal__form :global(.btn--primary) {
		align-self: flex-start;
		margin-top: var(--space-2);
	}

	.auth-modal__label {
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text);
	}

	.auth-modal__input {
		width: 100%;
		padding: var(--space-3) var(--space-5);
		font-family: var(--typ-interactive-1-font-family);
		font-size: var(--primitive-type-size-16);
		font-weight: var(--typ-interactive-1-font-weight);
		line-height: var(--typ-interactive-1-line-height);
		letter-spacing: var(--typ-interactive-1-letter-spacing);
		color: var(--color-text);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-input);
	}
	.auth-modal__input::placeholder {
		color: var(--color-text-muted);
	}
	.auth-modal__input:hover {
		border-color: var(--color-border-hover);
	}
	.auth-modal__input:focus {
		outline: none;
		box-shadow: var(--shadow-focus-input);
		border-color: var(--color-focus);
	}
	.auth-modal__input:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.auth-modal__password-wrap {
		position: relative;
		display: flex;
		align-items: stretch;
	}

	.auth-modal__input--with-toggle {
		padding-right: var(--space-input-icon-left);
	}

	.auth-modal__password-toggle {
		position: absolute;
		right: var(--space-2);
		top: 50%;
		transform: translateY(-50%);
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--min-tap);
		height: var(--min-tap);
		min-width: var(--min-tap);
		min-height: var(--min-tap);
		padding: 0;
		margin: 0;
		background: none;
		border: none;
		border-radius: var(--radius-pill);
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default);
	}
	.auth-modal__password-toggle:hover:not(:disabled) {
		color: var(--color-text);
		background: var(--color-interactive-hover-subtle);
	}
	.auth-modal__password-toggle:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.auth-modal__password-toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
