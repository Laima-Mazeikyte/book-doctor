<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Button from '$lib/components/Button.svelte';
	import { t } from '$lib/copy';
	import { getSupabase } from '$lib/supabase';
	import { authStore, clearPasswordRecoveryFlag, passwordRecoveryActive } from '$lib/stores/auth';
	import { Eye, EyeOff } from 'lucide-svelte';

	let password = $state('');
	let confirmPassword = $state('');
	let revealPassword = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let settled = $state(false);
	let recoveryFromHash = $state(false);

	onMount(() => {
		recoveryFromHash = window.location.hash.includes('type=recovery');
		const timer = window.setTimeout(() => {
			settled = true;
		}, 450);
		return () => window.clearTimeout(timer);
	});

	let session = $derived($authStore.session);
	let user = $derived($authStore.user);
	let recoveryActive = $derived($passwordRecoveryActive);

	let isFullAccount = $derived(!!session && !!user && user.is_anonymous !== true);

	let showForm = $derived(
		settled && isFullAccount && (recoveryActive || recoveryFromHash)
	);

	let showWrongContext = $derived(
		settled && isFullAccount && !recoveryActive && !recoveryFromHash
	);

	let showInvalid = $derived(settled && !showForm && !showWrongContext);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		if (password.length < 6) {
			error = t('shared.resetPasswordPage.errorWeak');
			return;
		}
		if (password !== confirmPassword) {
			error = t('shared.resetPasswordPage.errorMismatch');
			return;
		}
		const supabase = getSupabase();
		if (!supabase) {
			error = t('shared.authModal.errorUnableToConnect');
			return;
		}
		loading = true;
		const { error: err } = await supabase.auth.updateUser({ password });
		loading = false;
		if (err) {
			error = err.message ?? t('shared.resetPasswordPage.errorUpdateFailed');
			return;
		}
		clearPasswordRecoveryFlag();
		await goto('/rate');
	}
</script>

<div class="reset-password">
	<div class="reset-password__panel">
		<h1 class="reset-password__title">{t('shared.resetPasswordPage.title')}</h1>

		{#if error}
			<p class="reset-password__error" role="alert">{error}</p>
		{/if}

		{#if showForm}
			<form class="reset-password__form" onsubmit={handleSubmit}>
				<div class="reset-password__field">
					<label class="reset-password__label" for="reset-new-password">
						{t('shared.resetPasswordPage.newPassword')}
					</label>
					<p id="reset-password-hint" class="reset-password__hint">
						{t('shared.resetPasswordPage.passwordHint')}
					</p>
					<div class="reset-password__password-wrap">
						<input
							id="reset-new-password"
							type={revealPassword ? 'text' : 'password'}
							class="reset-password__input reset-password__input--with-toggle"
							bind:value={password}
							required
							minlength="6"
							autocomplete="new-password"
							aria-describedby="reset-password-hint"
							disabled={loading}
						/>
						<button
							type="button"
							class="reset-password__password-toggle"
							aria-label={revealPassword
								? t('shared.authModal.hidePassword')
								: t('shared.authModal.showPassword')}
							aria-pressed={revealPassword}
							disabled={loading}
							onclick={() => (revealPassword = !revealPassword)}
						>
							{#if revealPassword}
								<EyeOff size={20} aria-hidden="true" />
							{:else}
								<Eye size={20} aria-hidden="true" />
							{/if}
						</button>
					</div>
				</div>
				<div class="reset-password__field">
					<label class="reset-password__label" for="reset-confirm-password">
						{t('shared.resetPasswordPage.confirmPassword')}
					</label>
					<div class="reset-password__password-wrap">
						<input
							id="reset-confirm-password"
							type={revealPassword ? 'text' : 'password'}
							class="reset-password__input reset-password__input--with-toggle"
							bind:value={confirmPassword}
							required
							minlength="6"
							autocomplete="new-password"
							disabled={loading}
						/>
					</div>
				</div>
				<Button type="submit" variant="primary" pill disabled={loading}>
					{loading ? t('shared.resetPasswordPage.submitting') : t('shared.resetPasswordPage.submit')}
				</Button>
			</form>
		{:else if showWrongContext}
			<p class="reset-password__message">{t('shared.resetPasswordPage.useSignInInstead')}</p>
			<Button variant="secondary" pill href="/">{t('shared.resetPasswordPage.backHome')}</Button>
		{:else if showInvalid}
			<p class="reset-password__message">{t('shared.resetPasswordPage.invalidOrExpired')}</p>
			<Button variant="secondary" pill href="/">{t('shared.resetPasswordPage.backHome')}</Button>
		{:else}
			<p class="reset-password__message" aria-live="polite">{t('shared.resetPasswordPage.loading')}</p>
		{/if}
	</div>
</div>

<style>
	.reset-password {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: var(--space-8) var(--space-6);
		min-height: 50vh;
	}

	.reset-password__panel {
		width: 100%;
		max-width: 26rem;
		padding: var(--space-6) var(--space-8);
		background: var(--color-card-bg);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		text-align: left;
	}

	.reset-password__title {
		margin: 0 0 var(--space-5);
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.reset-password__message {
		margin: 0 0 var(--space-5);
		font-size: var(--font-size-sm);
		line-height: var(--line-height-normal);
		color: var(--color-text-muted);
	}

	.reset-password__error {
		margin: 0 0 var(--space-4);
		padding: var(--space-3) var(--space-4);
		font-size: var(--font-size-sm);
		color: var(--color-error-text);
		background: var(--color-error-bg);
		border: 1px solid var(--color-error-border);
		border-radius: var(--radius-sm);
	}

	.reset-password__form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.reset-password__field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.reset-password__hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.reset-password__label {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text);
	}

	.reset-password__input {
		width: 100%;
		padding: var(--space-3) var(--space-5);
		font-size: var(--font-size-md);
		color: var(--color-text);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-input);
	}
	.reset-password__input:focus {
		outline: none;
		box-shadow: var(--shadow-focus-input);
		border-color: var(--color-focus);
	}
	.reset-password__input:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.reset-password__password-wrap {
		position: relative;
		display: flex;
		align-items: stretch;
	}

	.reset-password__input--with-toggle {
		padding-right: var(--space-input-icon-left);
	}

	.reset-password__password-toggle {
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
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.reset-password__password-toggle:hover:not(:disabled) {
		color: var(--color-text);
		background: var(--color-bg-muted);
	}
	.reset-password__password-toggle:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.reset-password__password-toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.reset-password__form :global(.btn--primary) {
		align-self: flex-start;
		margin-top: var(--space-2);
	}
</style>
