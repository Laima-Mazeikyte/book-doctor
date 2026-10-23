<script lang="ts">
	import type { RecommendationSubmission } from '$lib/recommendations/requestRecommendations';
	import { t } from '$lib/copy';
	let {
		submission,
		onRetry = () => submission.submit(),
		retryDisabled = false
	}: {
		submission: RecommendationSubmission;
		onRetry?: () => void | Promise<void>;
		retryDisabled?: boolean;
	} = $props();
</script>

{#if $submission.status === 'submitting'}
	<span class="submission-status" role="status">{t('recommendations.submission.starting')}</span>
{/if}
{#if $submission.error}
	<div
		class="submission-error typ-body"
		role={$submission.status === 'submitting' ? 'status' : 'alert'}
		data-testid="recommendation-submission-error"
	>
		<span>{t(`recommendations.submission.${$submission.error}Error`)}</span>
		<span aria-hidden="true">·</span>
		<button
			type="button"
			aria-disabled={retryDisabled || $submission.status === 'submitting' ? 'true' : undefined}
			onclick={() => {
				if (!retryDisabled) void onRetry();
			}}
		>
			{t('recommendations.submission.retry')}
		</button>
	</div>
{/if}

<style>
	.submission-status {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	.submission-error {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		max-width: 100%;
		pointer-events: auto;
		color: var(--color-text);
	}
	button {
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
		min-height: var(--min-tap);
	}
	button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
