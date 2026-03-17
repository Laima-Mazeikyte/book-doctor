<script lang="ts">
	import { tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import Button from '$lib/components/Button.svelte';
	import { getSupabase } from '$lib/supabase';
	import { t } from '$lib/copy';

	interface Props {
		open: boolean;
		onClose: () => void;
		/** Initial tab when opening: 'signin' | 'signup' */
		initialTab?: 'signin' | 'signup';
	}

	let { open, onClose, initialTab = 'signin' }: Props = $props();

	let tab = $state<'signin' | 'signup'>('signin');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let successMessage = $state<string | null>(null);
	let closeButtonEl = $state<HTMLButtonElement | null>(null);
	let firstInputEl = $state<HTMLInputElement | null>(null);

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
			confirmPassword = '';
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

	async function handleSignIn(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		successMessage = null;
		const supabase = getSupabase();
		if (!supabase) {
			error = t('shared.authModal.errorUnableToConnect');
			return;
		}
		loading = true;
		const { error: err } = await supabase.auth.signInWithPassword({ email, password });
		loading = false;
		if (err) {
			error = err.message ?? t('shared.authModal.errorInvalidCredentials');
			return;
		}
		onClose();
	}

	async function handleSignUp(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		successMessage = null;
		if (password !== confirmPassword) {
			error = t('shared.authModal.errorPasswordsDoNotMatch');
			return;
		}
		const supabase = getSupabase();
		if (!supabase) {
			error = t('shared.authModal.errorUnableToConnect');
			return;
		}
		loading = true;

		const {
			data: { session: currentSession }
		} = await supabase.auth.getSession();
		const isAnonymous = currentSession?.user?.is_anonymous === true;
		const anonymousUserId = currentSession?.user?.id ?? null;

		if (isAnonymous && anonymousUserId) {
			// Prefer converting anonymous user (same ID → data stays). Requires manual linking in Supabase.
			const { data: updateData, error: updateErr } = await supabase.auth.updateUser({
				email,
				password
			});
			if (!updateErr) {
				loading = false;
				if (updateData?.user && !updateData.session) {
					successMessage = t('shared.authModal.successCheckEmail');
					return;
				}
				onClose();
				return;
			}
			// updateUser failed (e.g. manual linking disabled or email already exists): create new account and migrate data
			const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
				email,
				password
			});
			loading = false;
			if (signUpErr) {
				error = signUpErr.message ?? t('shared.authModal.errorSignUpFailed');
				return;
			}
			if (signUpData?.user && !signUpData.session) {
				successMessage = t('shared.authModal.successCheckEmail');
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
		const { data, error: err } = await supabase.auth.signUp({ email, password });
		loading = false;
		if (err) {
			error = err.message ?? t('shared.authModal.errorSignUpFailed');
			return;
		}
		if (data?.user && !data.session) {
			successMessage = t('shared.authModal.successCheckEmail');
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
			<div class="auth-modal__header">
				<h2 id={titleId} class="auth-modal__title">
					{tab === 'signin' ? t('shared.authModal.signIn') : t('shared.authModal.createAccount')}
				</h2>
				<Button
					variant="secondary"
					compact
					type="button"
					aria-label={t('shared.authModal.close')}
					ref={(el) => (closeButtonEl = el as HTMLButtonElement)}
					onclick={onClose}
				>
					{t('shared.authModal.close')}
				</Button>
			</div>

			<div class="auth-modal__tabs">
				<button
					type="button"
					class="auth-modal__tab"
					class:auth-modal__tab--active={tab === 'signin'}
					onclick={() => { tab = 'signin'; error = null; successMessage = null; }}
				>
					{t('shared.authModal.signIn')}
				</button>
				<button
					type="button"
					class="auth-modal__tab"
					class:auth-modal__tab--active={tab === 'signup'}
					onclick={() => { tab = 'signup'; error = null; successMessage = null; }}
				>
					{t('shared.authModal.createAccount')}
				</button>
			</div>

			{#if error}
				<p class="auth-modal__error" role="alert">{error}</p>
			{/if}
			{#if successMessage}
				<p class="auth-modal__success" role="status">{successMessage}</p>
			{/if}

			{#if tab === 'signin'}
				<form class="auth-modal__form" onsubmit={handleSignIn}>
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
					<label class="auth-modal__label" for="auth-password-signin">{t('shared.authModal.password')}</label>
					<input
						id="auth-password-signin"
						type="password"
						class="auth-modal__input"
						bind:value={password}
						required
						autocomplete="current-password"
						disabled={loading}
					/>
					<Button type="submit" variant="primary" disabled={loading}>
						{loading ? t('shared.authModal.signingIn') : t('shared.authModal.signIn')}
					</Button>
				</form>
			{:else}
				<form class="auth-modal__form" onsubmit={handleSignUp}>
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
					<label class="auth-modal__label" for="auth-password-signup">{t('shared.authModal.password')}</label>
					<input
						id="auth-password-signup"
						type="password"
						class="auth-modal__input"
						bind:value={password}
						required
						minlength="6"
						autocomplete="new-password"
						disabled={loading}
					/>
					<label class="auth-modal__label" for="auth-confirm-password">{t('shared.authModal.confirmPassword')}</label>
					<input
						id="auth-confirm-password"
						type="password"
						class="auth-modal__input"
						bind:value={confirmPassword}
						required
						autocomplete="new-password"
						disabled={loading}
					/>
					<Button type="submit" variant="primary" disabled={loading}>
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
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
	}

	.auth-modal-panel {
		background: var(--color-card-bg);
		border-radius: var(--radius-md);
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
		width: 100%;
		max-width: 24rem;
		padding: var(--space-5);
	}

	.auth-modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-4);
	}

	.auth-modal__title {
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		margin: 0;
	}

	.auth-modal__tabs {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	.auth-modal__tab {
		padding: var(--space-2) var(--space-4);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.auth-modal__tab:hover {
		color: var(--color-text);
		background: var(--color-bg-muted);
	}
	.auth-modal__tab--active {
		color: var(--color-accent);
		background: var(--color-accent-bg);
		border-color: var(--color-border);
	}
	.auth-modal__tab:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}

	.auth-modal__error {
		margin: 0 0 var(--space-4);
		padding: var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-error-text);
		background: var(--color-error-bg);
		border: 1px solid var(--color-error-border);
		border-radius: var(--radius-sm);
	}

	.auth-modal__success {
		margin: 0 0 var(--space-4);
		padding: var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		background: var(--color-accent-bg);
		border-radius: var(--radius-sm);
	}

	.auth-modal__form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.auth-modal__label {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text);
	}

	.auth-modal__input {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		font-size: var(--font-size-md);
		line-height: var(--line-height-normal);
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
</style>
