<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/copy';

	/** Copy for each card lives under `lab.experiments.<key>`. */
	const experiments = [
		{ key: 'authorConnections', path: '/lab/author-connections' },
		{ key: 'authorProminence', path: '/lab/author-prominence' }
	] as const;
</script>

<svelte:head>
	<title>{t('lab.title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('lab.metaDescription')} />
</svelte:head>

<div class="lab-page">
	<h1 class="lab-page__title typ-display2 typ-display2--content">{t('lab.title')}</h1>
	<p class="lab-page__lead typ-body">{t('lab.lead')}</p>

	<ul class="lab-page__list">
		{#each experiments as experiment (experiment.path)}
			<li>
				<a class="lab-card" href={resolve(experiment.path)}>
					<h2 class="lab-card__title typ-h3">{t(`lab.experiments.${experiment.key}.name`)}</h2>
					<p class="lab-card__blurb">{t(`lab.experiments.${experiment.key}.blurb`)}</p>
					<span class="lab-card__cta">{t(`lab.experiments.${experiment.key}.cta`)} →</span>
				</a>
			</li>
		{/each}
	</ul>
</div>

<style>
	.lab-page {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 52rem;
		margin-inline: auto;
		padding-bottom: var(--space-8);
	}
	.lab-page__title {
		margin: 0 0 var(--space-4) 0;
		text-align: center;
	}
	.lab-page__lead {
		margin: 0 0 var(--space-8) 0;
		text-align: center;
		color: var(--color-text-muted);
	}
	.lab-page__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-4);
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
	}
	.lab-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		height: 100%;
		padding: var(--space-5);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		text-decoration: none;
		color: var(--color-text);
		transition:
			border-color var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default);
	}
	.lab-card:hover {
		border-color: var(--color-border-hover);
		background: var(--color-bg-hover);
	}
	.lab-card:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.lab-card__title {
		margin: 0;
	}
	.lab-card__blurb {
		margin: 0;
		flex: 1;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.6;
		color: var(--color-text-muted);
	}
	.lab-card__cta {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-accent);
	}
</style>
