<script lang="ts">
	import { t } from '$lib/copy';

	interface Props {
		onOpenBugReport: () => void;
	}

	let { onOpenBugReport }: Props = $props();
</script>

<footer class="app-footer" aria-label={t('shared.footer.ariaLabel')}>
	<div class="app-footer__inner">
		<ul class="app-footer__links">
			<li>
				<a href="/faq" class="app-footer__link">{t('shared.footer.faq')}</a>
			</li>
			<li>
				<button type="button" class="app-footer__link" onclick={onOpenBugReport}>
					{t('shared.footer.reportBug')}
				</button>
			</li>
		</ul>
	</div>
</footer>

<style>
	.app-footer {
		background: var(--color-bg);
	}
	.app-footer__inner {
		max-width: var(--content-width-narrow);
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
	}
	@media (min-width: 768px) {
		.app-footer__inner {
			max-width: var(--content-width-wide);
			padding: var(--space-5) var(--space-5);
		}
	}
	.app-footer__links {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
	}
	.app-footer__link {
		display: inline-flex;
		align-items: center;
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
		text-decoration: none;
		white-space: nowrap;
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
		border-radius: var(--radius-pill);
		transition: color 0.15s ease, background 0.15s ease;
	}
	.app-footer__link:hover {
		color: var(--color-text);
		background: var(--color-interactive-hover-subtle);
	}
	.app-footer__link:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	button.app-footer__link {
		background: none;
		border: none;
		cursor: pointer;
		justify-content: flex-start;
	}
</style>
