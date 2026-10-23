<script lang="ts">
	import { librarySaves } from '$lib/stores/librarySaves';
	import { ensureAnonymousSessionStarted } from '$lib/auth/anonymous-session';
	import { getSupabase } from '$lib/supabase';
	import { t } from '$lib/copy';
	let retrying = $state(false);
	const failed = $derived($librarySaves.changes.filter((change) => change.status === 'failed'));
	const labels = $derived(
		['rating', 'bookmark', 'dismissal'].flatMap((kind) => {
			const count = failed.filter((change) => change.kind === kind).length;
			return count ? [t(`librarySaves.${kind}_${count === 1 ? 'one' : 'other'}`, { count })] : [];
		})
	);
	const changes = $derived(
		new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(labels)
	);
	const authenticationFailed = $derived(
		failed.some((change) => change.errorKind === 'authentication')
	);
	async function retry() {
		if (retrying) return;
		retrying = true;
		try {
			const owner = librarySaves.getOwner();
			if (owner.startsWith('guest:')) {
				if (!(await ensureAnonymousSessionStarted())) return;
			} else if (authenticationFailed) {
				await getSupabase()?.auth.refreshSession();
				if (librarySaves.getOwner() !== owner) return;
			}
			await librarySaves.retryFailed();
		} catch {
			/* The controller retains failed work and exposes its status. */
		} finally {
			retrying = false;
		}
	}
</script>

{#if failed.length}
	<aside
		class="library-save-notice"
		aria-label={t('librarySaves.noticeLabel')}
		data-testid="library-save-notice"
	>
		<div role="status" aria-live="polite">
			<p>{t('librarySaves.failed', { changes })}</p>
			{#if authenticationFailed}<p>{t('librarySaves.authentication')}</p>{/if}
		</div>
		<button class="btn btn--secondary btn--compact" onclick={retry} disabled={retrying}>
			{retrying ? t('librarySaves.retrying') : t('librarySaves.retry')}
		</button>
	</aside>
{/if}

<style>
	.library-save-notice {
		position: fixed;
		right: var(--space-4);
		bottom: calc(6rem + env(safe-area-inset-bottom, 0px));
		z-index: 150;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: fit-content;
		max-width: min(32rem, calc(100vw - 2 * var(--space-4)));
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-danger-tonal-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		box-shadow: var(--shadow-modal-elevated);
		color: var(--color-text);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
	}
	p {
		margin: 0;
	}
	p + p {
		margin-top: var(--space-1);
		color: var(--color-text-muted);
	}
	button {
		flex-shrink: 0;
	}
</style>
