import type { Badge, RecognitionReceipt } from './types';
import { t } from '$lib/copy';

export interface RankingEntry {
	index: number;
	place: number;
	name: string;
	score: string;
	badges: Badge[];
	books: number;
	recognitions: number;
}

export interface SelectedAuthorSnapshot {
	index: number;
	name: string;
	place: number;
	score: string;
	values: number[];
	badges: Badge[];
}

export interface ContributionSegment {
	feature: string;
	label: string;
	value: number;
	colour: string;
}

export interface RecognitionWork {
	title: string;
	receipts: RecognitionReceipt[];
}

/** User-facing status copy for the compact recognition receipt list. */
export function recognitionStatusLabel(status: string): string {
	let key: string;
	switch (status.trim().toLowerCase()) {
		case 'win':
			key = 'win';
			break;
		case 'shortlist':
			key = 'shortlist';
			break;
		case 'longlist':
			key = 'longlist';
			break;
		case 'nominee':
			key = 'nominee';
			break;
		case 'honor':
			key = 'honor';
			break;
		default:
			key = 'recognized';
	}
	return t(`lab.authorProminence.detail.recognitionStatus.${key}`);
}

/** Remove exact duplicate receipts and group by first-seen work without reordering receipts. */
export function groupRecognitionReceipts(
	receipts: readonly RecognitionReceipt[]
): RecognitionWork[] {
	const seen = new Set<string>();
	const grouped = new Map<string, RecognitionWork>();
	for (const receipt of receipts) {
		const key = JSON.stringify([
			receipt.workTitle,
			receipt.awardName,
			receipt.year,
			receipt.status,
			receipt.tier
		]);
		if (seen.has(key)) continue;
		seen.add(key);
		let work = grouped.get(receipt.workTitle);
		if (!work) {
			work = { title: receipt.workTitle, receipts: [] };
			grouped.set(receipt.workTitle, work);
		}
		work.receipts.push(receipt);
	}
	return Array.from(grouped.values());
}

export function formatPeakPercentage(weight: number): string {
	return `${Math.round(weight * 100)}%`;
}
