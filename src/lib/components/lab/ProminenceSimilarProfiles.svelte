<script lang="ts">
	import { t } from '$lib/copy';
	import type { SimilarityProfile } from '$lib/lab/author-prominence/similarity';

	export interface SimilarProfileRow extends SimilarityProfile {
		name: string;
		place: number;
	}

	interface Props {
		profiles: SimilarProfileRow[];
		onSelect: (index: number) => void;
		onHover: (index: number | null) => void;
	}

	let { profiles, onSelect, onHover }: Props = $props();
</script>

{#if profiles.length > 0}
	<section class="prominence-similar" data-testid="prominence-similar">
		<h3>{t('lab.authorProminence.detail.similarProfiles')}</h3>
		<div class="prominence-similar__list">
			{#each profiles as profile (profile.index)}
				<button
					type="button"
					class="prominence-similar__row"
					aria-label={`${profile.name}, current rank ${profile.place > 0 ? profile.place : 'updating'}`}
					onpointerenter={() => onHover(profile.index)}
					onpointerleave={() => onHover(null)}
					onfocus={() => onHover(profile.index)}
					onblur={() => onHover(null)}
					onclick={() => onSelect(profile.index)}
				>
					<strong>{profile.name}</strong>
					<span>{profile.place > 0 ? `#${profile.place.toLocaleString()}` : '…'}</span>
				</button>
			{/each}
		</div>
	</section>
{/if}

<style>
	.prominence-similar {
		padding-top: 10px;
		border-top: 1px solid rgba(164, 204, 206, 0.14);
	}
	.prominence-similar h3 {
		margin: 0 0 8px;
		color: rgba(207, 231, 232, 0.72);
		font: 600 11px/1.2 var(--font-family-interactive);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.prominence-similar__list {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
	}
	.prominence-similar__row {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 7px;
		width: 100%;
		min-height: 44px;
		padding: 8px 9px;
		box-sizing: border-box;
		border: 1px solid rgba(164, 204, 206, 0.18);
		border-radius: 5px;
		background: rgba(164, 204, 206, 0.035);
		color: #efffff;
		text-align: left;
		cursor: pointer;
		font-family: var(--font-family-interactive);
		white-space: nowrap;
	}
	.prominence-similar__row:hover,
	.prominence-similar__row:focus-visible {
		border-color: rgba(134, 216, 189, 0.52);
		background: rgba(57, 197, 150, 0.1);
	}
	.prominence-similar__row:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.prominence-similar__row strong {
		min-width: 0;
		overflow: hidden;
		font-size: 12px;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.prominence-similar__row span {
		flex: 0 0 auto;
		color: rgba(207, 231, 232, 0.7);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}
</style>
