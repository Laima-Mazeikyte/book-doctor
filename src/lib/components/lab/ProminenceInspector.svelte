<script lang="ts">
	import { formatContribution } from '$lib/lab/author-prominence/score';
	import { formatRelativePosition, type DisplayModel } from '$lib/lab/author-prominence/display';
	import type { PresetProfile } from '$lib/lab/author-prominence/ranking-engine';
	import type {
		ContributionRow,
		SelectedAuthorSnapshot
	} from '$lib/lab/author-prominence/presentation';

	interface Props {
		display: DisplayModel;
		selected: SelectedAuthorSnapshot | null;
		rows: ContributionRow[];
		profiles: PresetProfile[];
		currentPresetId: string | null;
		onClear: () => void;
	}

	let { display, selected, rows, profiles, currentPresetId, onClear }: Props = $props();
</script>

{#if selected}
	<section
		class="prominence-inspector"
		aria-labelledby="inspector-heading"
		data-testid="prominence-inspector"
		data-selected-score={selected
			? String(selected.values.reduce((sum, value) => sum + value, 0))
			: undefined}
		data-display-shares={selected ? rows.map((row) => row.displayShare).join('/') : undefined}
	>
		<div class="prominence-inspector__header">
			<div>
				<h2 id="inspector-heading" tabindex="-1">{selected.name}</h2>
			</div>
			<button type="button" class="clear-button" onclick={onClear}
				>Clear <span aria-hidden="true">×</span></button
			>
		</div>
		<div class="prominence-inspector__rankline">
			<strong>#{selected.place.toLocaleString()}</strong><span
				>of {display.count.toLocaleString()}</span
			>
		</div>
		<div class="inspector-block">
			<div class="inspector-block__heading">
				<h3>Current composition</h3>
				<strong>{selected.score}</strong>
			</div>
			<div class="contribution-detail">
				{#each rows as row (row.feature)}
					<div class="contribution-detail__row">
						<div class="contribution-detail__top">
							<span><i style:background={row.colour}></i>{row.label}</span><strong
								>{formatContribution(row.value)}</strong
							>
						</div>
						<div class="contribution-detail__track">
							<span class="contribution-detail__zero"></span><span
								class:negative={row.value < 0}
								class="contribution-detail__fill"
								style:--contribution-width={`${row.width}%`}
								style:background={row.colour}
							></span>
						</div>
						<p>
							{formatRelativePosition(row.z)} · weighted at {row.displayShare}% · contributes {formatContribution(
								row.value
							)}
						</p>
					</div>
				{/each}
			</div>
		</div>
		<div class="inspector-block">
			<div class="inspector-block__heading">
				<h3>Evidence</h3>
			</div>
			<dl class="evidence-grid">
				<div>
					<dt>Distinct readers</dt>
					<dd>{selected.readers.toLocaleString()}</dd>
				</div>
				<div>
					<dt>Eligible books</dt>
					<dd>{selected.books.toLocaleString()}</dd>
				</div>
				<div>
					<dt>Recorded awards</dt>
					<dd>{selected.tier ? selected.awards.toLocaleString() : 'None recorded'}</dd>
				</div>
				<div>
					<dt>Best award tier</dt>
					<dd>{selected.tier ? `Tier ${selected.tier}` : 'None recorded'}</dd>
				</div>
				{#if Number.isFinite(selected.concentration)}<div>
						<dt>Audience concentration</dt>
						<dd>{selected.concentration.toFixed(2)}</dd>
					</div>{/if}
			</dl>
		</div>
		<div class="inspector-block">
			<div class="inspector-block__heading">
				<h3>Across the four lenses</h3>
			</div>
			<div class="lens-profile">
				{#each profiles as profile (profile.name)}<div
						class:active={profile.name === currentPresetId}
						class="lens-profile__item"
					>
						<span>{profile.name}</span><strong>#{profile.place.toLocaleString()}</strong>
					</div>{/each}
			</div>
		</div>
		{#if selected.badges.length > 0}<div class="observations">
				<h3>Evidence observations</h3>
				{#each selected.badges as badge (badge.badge)}<div class="observation">
						<span>{badge.badge}</span>
						<p>{badge.explain}</p>
					</div>{/each}
			</div>{/if}
	</section>
{/if}

<style>
	.prominence-inspector {
		padding-bottom: 16px;
	}
	.prominence-inspector__header {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 12px;
	}
	.prominence-inspector h2 {
		margin: 0;
		color: #efffff;
		font: 500 26px var(--font-family-content);
	}
	.clear-button {
		min-height: 44px;
		padding: 5px 4px;
		border: 0;
		background: transparent;
		color: rgba(207, 231, 232, 0.68);
		cursor: pointer;
		font: 12px var(--font-family-interactive);
	}
	.prominence-inspector__rankline {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-top: 13px;
		color: rgba(207, 231, 232, 0.62);
		font: 12px var(--font-family-interactive);
	}
	.prominence-inspector__rankline strong {
		color: #efffff;
		font: 500 28px var(--font-family-content);
	}
	.inspector-block {
		padding: 15px 0;
		border-top: 1px solid rgba(164, 204, 206, 0.14);
	}
	.inspector-block__heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.inspector-block h3,
	.observations h3 {
		margin: 0;
		color: #d8eeee;
		font: 600 13px var(--font-family-interactive);
	}
	.inspector-block__heading strong {
		color: #bce8d8;
		font: 600 17px var(--font-family-interactive);
	}
	.contribution-detail {
		display: grid;
		gap: 12px;
		margin-top: 13px;
	}
	.contribution-detail__top {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		color: rgba(207, 231, 232, 0.76);
		font: 12px var(--font-family-interactive);
	}
	.contribution-detail__top span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.contribution-detail__top i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.contribution-detail__track {
		position: relative;
		height: 8px;
		margin-top: 6px;
		overflow: hidden;
		border-radius: 3px;
		background: linear-gradient(
			90deg,
			rgba(207, 231, 232, 0.12) 49.5%,
			rgba(207, 231, 232, 0.4) 50%,
			rgba(207, 231, 232, 0.12) 50.5%
		);
	}
	.contribution-detail__zero {
		position: absolute;
		inset-block: 0;
		left: 50%;
		width: 1px;
		background: rgba(207, 231, 232, 0.5);
	}
	.contribution-detail__fill {
		position: absolute;
		top: 1px;
		left: 50%;
		width: var(--contribution-width);
		height: 6px;
		border-radius: 3px;
	}
	.contribution-detail__fill.negative {
		right: 50%;
		left: auto;
	}
	.contribution-detail__row p {
		margin: 5px 0 0;
		color: rgba(207, 231, 232, 0.62);
		font: 12px/1.4 var(--font-family-interactive);
	}
	.evidence-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
		margin: 13px 0 0;
	}
	.evidence-grid dt {
		color: rgba(207, 231, 232, 0.56);
		font: 11px var(--font-family-interactive);
	}
	.evidence-grid dd {
		margin: 3px 0 0;
		color: #d8eeee;
		font: 13px var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
	}
	.lens-profile {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 5px;
		margin-top: 12px;
	}
	.lens-profile__item {
		display: flex;
		justify-content: space-between;
		gap: 5px;
		min-height: 38px;
		padding: 8px;
		border: 1px solid rgba(164, 204, 206, 0.14);
		border-radius: 5px;
		color: rgba(207, 231, 232, 0.64);
		font: 11px var(--font-family-interactive);
	}
	.lens-profile__item.active {
		border-color: rgba(57, 197, 150, 0.5);
		color: #efffff;
	}
	.observations {
		padding: 13px;
		border: 1px solid rgba(224, 165, 47, 0.22);
		border-radius: 7px;
		background: rgba(64, 48, 19, 0.16);
	}
	.observation + .observation {
		margin-top: 11px;
		padding-top: 11px;
		border-top: 1px solid rgba(224, 165, 47, 0.15);
	}
	.observation span {
		color: #f3c964;
		font: 600 12px var(--font-family-interactive);
	}
	.observation p {
		margin: 4px 0 0;
		color: rgba(243, 201, 100, 0.78);
		font: 12px/1.45 var(--font-family-interactive);
	}
	.negative {
		color: #efaa94;
	}
</style>
