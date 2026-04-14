<script lang="ts">
	import { tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { PUBLIC_HCAPTCHA_SITEKEY } from '$env/static/public';
	import Button from '$lib/components/Button.svelte';
	import { getSupabase } from '$lib/supabase';
	import { loadHcaptchaExplicit } from '$lib/hcaptcha-script';
	import { t } from '$lib/copy';
	import { Eye, EyeOff } from 'lucide-svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		/** Initial tab when opening: 'signin' | 'signup' */
		initialTab?: 'signin' | 'signup';
	}

	let { open, onClose, initialTab = 'signin' }: Props = $props();

	let tab = $state<'signin' | 'signup' | 'forgot'>('signin');
	let email = $state('');
	let password = $state('');
	let revealSignInPassword = $state(false);
	let revealSignUpPassword = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let successMessage = $state<string | null>(null);
	let closeButtonEl = $state<HTMLButtonElement | null>(null);
	let firstInputEl = $state<HTMLInputElement | null>(null);
	let hcaptchaContainerEl = $state<HTMLDivElement | null>(null);
	/** Not $state: assigning inside $effect must not retrigger that effect (would double-render widgets). */
	let hcaptchaWidgetId: number | null = null;

	const hcaptchaSiteKey =
		typeof PUBLIC_HCAPTCHA_SITEKEY === 'string' ? PUBLIC_HCAPTCHA_SITEKEY.trim() : '';
	const useHcaptcha = hcaptchaSiteKey.length > 0;

	const panelId = 'auth-modal-panel';
	const titleId = 'auth-modal-title';

	function portal(node: HTMLElement, target: HTMLElement = document.body) {
		target.appendChild(node);
		return {
			destroy() {
				node.parentNode?.removeChild(node);
			}
		};
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	$effect(() => {
		if (open) {
			tab = initialTab;
			email = '';
			password = '';
			revealSignInPassword = false;
			revealSignUpPassword = false;
			error = null;
			successMessage = null;
		}
	});

	function handleOverlayKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onClose();
		}
	}

	$effect(() => {
		if (!open) return;
		tick().then(() => {
			closeButtonEl?.focus();
			firstInputEl?.focus();
		});
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

	$effect(() => {
		if (!useHcaptcha) return;

		/* Widget mounts on sign-in, sign-up, and forgot (same ref swaps with the active tab). */
		if (!open) {
			if (hcaptchaWidgetId !== null && typeof window !== 'undefined' && window.hcaptcha) {
				try {
					window.hcaptcha.remove(hcaptchaWidgetId);
				} catch {
					/* ignore */
				}
			}
			hcaptchaWidgetId = null;
			return;
		}

		if (!hcaptchaContainerEl) return;

		let cancelled = false;
		let createdId: number | null = null;

		void (async () => {
			try {
				await loadHcaptchaExplicit();
				if (cancelled) return;
				await tick();
				if (cancelled || !hcaptchaContainerEl || !window.hcaptcha) return;
				createdId = window.hcaptcha.render(hcaptchaContainerEl, {
					sitekey: hcaptchaSiteKey,
					theme: 'dark'
				});
				if (cancelled) {
					window.hcaptcha.remove(createdId);
					return;
				}
				hcaptchaWidgetId = createdId;
			} catch (e) {
				console.error('[hCaptcha] load/render failed', e);
			}
		})();

		return () => {
			cancelled = true;
			if (createdId !== null && typeof window !== 'undefined' && window.hcaptcha) {
				try {
					window.hcaptcha.remove(createdId);
				} catch {
					/* ignore */
				}
				if (hcaptchaWidgetId === createdId) hcaptchaWidgetId = null;
			}
		};
	});

	function getHcaptchaToken(): string | undefined {
		if (!useHcaptcha) return undefined;
		if (hcaptchaWidgetId === null || !window.hcaptcha) return undefined;
		const token = window.hcaptcha.getResponse(hcaptchaWidgetId);
		return token && token.length > 0 ? token : undefined;
	}

	function resetHcaptcha() {
		if (hcaptchaWidgetId !== null && typeof window !== 'undefined' && window.hcaptcha) {
			try {
				window.hcaptcha.reset(hcaptchaWidgetId);
			} catch {
				/* ignore */
			}
		}
	}

	async function handleForgotPassword(e: SubmitEvent) {
		e.preventDefault();
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

		const captchaToken = getHcaptchaToken();
		if (useHcaptcha && !captchaToken) {
			error = t('shared.authModal.errorCaptchaRequired');
			return;
		}

		loading = true;
		const origin = typeof window !== 'undefined' ? window.location.origin : '';
		const resetOptions = captchaToken
			? {
					captchaToken,
					redirectTo: `${origin}/auth/reset-password`
				}
			: { redirectTo: `${origin}/auth/reset-password` };
		const { error: err } = await supabase.auth.resetPasswordForEmail(trimmed, resetOptions);
		loading = false;
		if (err) {
			error = err.message ?? t('shared.authModal.errorResetEmailFailed');
			resetHcaptcha();
			return;
		}
		successMessage = t('shared.authModal.successResetEmailSent');
	}

	async function handleSignIn(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		successMessage = null;
		const supabase = getSupabase();
		if (!supabase) {
			error = t('shared.authModal.errorUnableToConnect');
			return;
		}

		const captchaToken = getHcaptchaToken();
		if (useHcaptcha && !captchaToken) {
			error = t('shared.authModal.errorCaptchaRequired');
			return;
		}

		loading = true;
		const { error: err } = await supabase.auth.signInWithPassword({
			email,
			password,
			...(captchaToken ? { options: { captchaToken } } : {})
		});
		loading = false;
		if (err) {
			error = err.message ?? t('shared.authModal.errorInvalidCredentials');
			resetHcaptcha();
			return;
		}
		onClose();
	}

	async function handleSignUp(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		successMessage = null;
		const supabase = getSupabase();
		if (!supabase) {
			error = t('shared.authModal.errorUnableToConnect');
			return;
		}

		const captchaToken = getHcaptchaToken();
		if (useHcaptcha && !captchaToken) {
			error = t('shared.authModal.errorCaptchaRequired');
			return;
		}

		const signUpOptions = captchaToken ? { captchaToken } : undefined;

		loading = true;

		const {
			data: { session: currentSession }
		} = await supabase.auth.getSession();
		const isAnonymous = currentSession?.user?.is_anonymous === true;
		const anonymousUserId = currentSession?.user?.id ?? null;

		if (isAnonymous && anonymousUserId) {
			// Prefer converting anonymous user (same ID → data stays). Requires manual linking in Supabase.
			const { error: updateErr } = await supabase.auth.updateUser({
				email,
				password
			});
			if (!updateErr) {
				loading = false;
				onClose();
				return;
			}
			// updateUser failed (e.g. manual linking disabled or email already exists): create new account and migrate data
			const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
				email,
				password,
				options: signUpOptions
			});
			loading = false;
			if (signUpErr) {
				error = signUpErr.message ?? t('shared.authModal.errorSignUpFailed');
				resetHcaptcha();
				return;
			}
			// New user created with session: migrate anonymous data to this account
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
					if (res.ok) {
						window.dispatchEvent(new CustomEvent('auth:ratings-migrated'));
					} else {
						console.warn('[auth] Migrate anonymous data failed:', res.status, await res.text());
					}
				} catch (e) {
					console.warn('[auth] Migrate anonymous data request failed', e);
				}
			}
			onClose();
			return;
		}

		// No anonymous session: create account normally
		const { data, error: err } = await supabase.auth.signUp({
			email,
			password,
			options: signUpOptions
		});
		loading = false;
		if (err) {
			error = err.message ?? t('shared.authModal.errorSignUpFailed');
			resetHcaptcha();
			return;
		}
		onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

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
		onkeydown={handleOverlayKeydown}
		transition:fade={{ duration: 150 }}
	>
		<div
			class="auth-modal-panel"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
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
					ref={(el) => (closeButtonEl = el as HTMLButtonElement)}
					onclick={onClose}
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
						<label class="auth-modal__label" for="auth-email-forgot">{t('shared.authModal.email')}</label>
						<input
							bind:this={firstInputEl}
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
					{#if useHcaptcha}
						<div
							class="auth-modal__hcaptcha"
							bind:this={hcaptchaContainerEl}
							aria-hidden="true"
						></div>
					{/if}
					<Button type="submit" variant="primary" pill disabled={loading}>
						{loading ? t('shared.authModal.sendingResetLink') : t('shared.authModal.sendResetLink')}
					</Button>
				</form>
			{:else if tab === 'signin'}
				<form class="auth-modal__form" onsubmit={handleSignIn}>
					<div class="auth-modal__field">
						<label class="auth-modal__label" for="auth-email-signin">{t('shared.authModal.email')}</label>
						<input
							bind:this={firstInputEl}
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
						<label class="auth-modal__label" for="auth-password-signin">{t('shared.authModal.password')}</label>
						<div class="auth-modal__password-wrap">
							<input
								id="auth-password-signin"
								type={revealSignInPassword ? 'text' : 'password'}
								class="auth-modal__input auth-modal__input--with-toggle"
								bind:value={password}
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
					{#if useHcaptcha}
						<div
							class="auth-modal__hcaptcha"
							bind:this={hcaptchaContainerEl}
							aria-hidden="true"
						></div>
					{/if}
					<Button type="submit" variant="primary" pill disabled={loading}>
						{loading ? t('shared.authModal.signingIn') : t('shared.authModal.signIn')}
					</Button>
				</form>
			{:else}
				<form class="auth-modal__form" onsubmit={handleSignUp}>
					<div class="auth-modal__field">
						<label class="auth-modal__label" for="auth-email-signup">{t('shared.authModal.email')}</label>
						<input
							bind:this={firstInputEl}
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
						<label class="auth-modal__label" for="auth-password-signup">{t('shared.authModal.password')}</label>
						<p id="auth-password-signup-hint" class="auth-modal__hint">
							{t('shared.authModal.passwordRulesSignUp')}
						</p>
						<div class="auth-modal__password-wrap">
							<input
								id="auth-password-signup"
								type={revealSignUpPassword ? 'text' : 'password'}
								class="auth-modal__input auth-modal__input--with-toggle"
								bind:value={password}
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
					{#if useHcaptcha}
						<div
							class="auth-modal__hcaptcha"
							bind:this={hcaptchaContainerEl}
							aria-hidden="true"
						></div>
					{/if}
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
		border-radius: var(--radius-sm);
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
		gap: var(--space-5);
		flex: 1;
		min-width: 0;
		border-bottom: 1px solid var(--color-border);
	}

	.auth-modal__tab {
		padding: var(--space-3) 0 calc(var(--space-3) + 1px);
		margin-bottom: -1px;
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		border-radius: 0;
		cursor: pointer;
	}
	.auth-modal__tab:hover {
		color: var(--color-text);
	}
	.auth-modal__tab--active {
		color: var(--color-text);
		font-weight: var(--font-weight-semibold);
		border-bottom-color: var(--color-accent);
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
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default);
	}
	.auth-modal__password-toggle:hover:not(:disabled) {
		color: var(--color-text);
		background: var(--color-bg-muted);
	}
	.auth-modal__password-toggle:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.auth-modal__password-toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.auth-modal__hcaptcha {
		display: flex;
		justify-content: flex-start;
		min-height: 4.875rem;
	}
</style>
