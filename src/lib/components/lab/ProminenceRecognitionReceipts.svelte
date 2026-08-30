<script lang="ts">
	import { t } from '$lib/copy';
	import {
		groupRecognitionReceipts,
		recognitionStatusLabel
	} from '$lib/lab/author-prominence/presentation';
	import type { RecognitionReceipt } from '$lib/lab/author-prominence/types';

	interface Props {
		receipts: RecognitionReceipt[];
	}

	let { receipts }: Props = $props();
	const works = $derived(groupRecognitionReceipts(receipts).slice(0, 5));
</script>

{#if works.length > 0}
	<section class="prominence-recognitions" data-testid="prominence-recognitions">
		<h3>{t('lab.authorProminence.detail.recordedRecognitions')}</h3>
		<ul class="prominence-recognitions__works">
			{#each works as work (work.title)}
				<li>
					<strong>{work.title}</strong>
					<ul class="prominence-recognitions__receipts">
						{#each work.receipts as receipt, index (`${receipt.awardName}-${receipt.year}-${receipt.status}-${index}`)}
							<li>
								<span>{receipt.awardName}</span>
								{#if receipt.year !== null}<span>{receipt.year}</span>{/if}
								<span class="prominence-recognitions__status"
									>{recognitionStatusLabel(receipt.status)}</span
								>
							</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.prominence-recognitions {
		padding-top: 16px;
		border-top: 1px solid rgba(164, 204, 206, 0.14);
	}
	.prominence-recognitions h3 {
		margin: 0;
		color: rgba(207, 231, 232, 0.72);
		font: 600 11px/1.2 var(--font-family-interactive);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.prominence-recognitions__works,
	.prominence-recognitions__receipts {
		margin: 10px 0 0;
		padding: 0;
		list-style: none;
	}
	.prominence-recognitions__works > li + li {
		margin-top: 12px;
	}
	.prominence-recognitions__works > li > strong {
		display: block;
		color: #efffff;
		font: 600 12px/1.3 var(--font-family-interactive);
	}
	.prominence-recognitions__receipts {
		margin-top: 5px;
		padding-left: 9px;
		border-left: 2px solid rgba(224, 165, 47, 0.28);
	}
	.prominence-recognitions__receipts li {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 3px 7px;
		color: rgba(207, 231, 232, 0.65);
		font: 11px/1.35 var(--font-family-interactive);
	}
	.prominence-recognitions__receipts li + li {
		margin-top: 5px;
	}
	.prominence-recognitions__status {
		color: #f3c964;
		font-weight: 650;
	}
	.prominence-recognitions__status::before {
		content: '·';
		margin-right: 7px;
		color: rgba(207, 231, 232, 0.42);
	}
</style>
