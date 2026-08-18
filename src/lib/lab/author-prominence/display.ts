import type { Population, ProminenceManifest } from './types';

export const FEATURE_COLOURS = ['#39c596', '#9b8cf4', '#e0a52f'];
export const FEATURE_COLOURS_BY_KEY: Record<string, string> = {
	regard: '#39c596',
	reach: '#9b8cf4',
	recognition: '#e0a52f'
};

export interface DisplayFeature {
	key: string;
	label: string;
	blurb: string;
	colour: string;
}

export interface DisplayModel {
	count: number;
	featureIndices: Record<string, number>;
	worldFeatureIndices: { regard: number; reach: number; recognition: number };
	axisFeatures: [DisplayFeature, DisplayFeature, DisplayFeature];
	features: DisplayFeature[];
	domain: number;
	topN: number;
}

function cleanDomain(value: number): number {
	if (!(value > 0)) return 1;
	return Math.max(0.5, Math.ceil(value * 2) / 2);
}

/** Build all release-dependent display facts once; a weight change never changes the domain. */
export function buildDisplayModel(
	population: Population,
	manifest: ProminenceManifest
): DisplayModel {
	let largest = 0;
	for (const column of population.z) {
		for (let index = 0; index < column.length; index++) {
			if (Number.isFinite(column[index])) largest = Math.max(largest, Math.abs(column[index]));
		}
	}
	return {
		count: population.count,
		featureIndices: Object.fromEntries(
			manifest.model.features.map((feature, index) => [feature, index])
		),
		features: manifest.model.features.map((key, index) => ({
			key,
			label: manifest.model.feature_labels[key] ?? key,
			blurb: manifest.model.feature_blurbs[key] ?? '',
			colour: FEATURE_COLOURS_BY_KEY[key] ?? FEATURE_COLOURS[index] ?? '#d8eeee'
		})),
		domain: cleanDomain(largest),
		topN: manifest.display.top_n,
		worldFeatureIndices: {
			regard: manifest.model.features.indexOf('regard'),
			reach: manifest.model.features.indexOf('reach'),
			recognition: manifest.model.features.indexOf('recognition')
		},
		axisFeatures: [
			{
				key: 'regard',
				label: manifest.model.feature_labels.regard,
				blurb: manifest.model.feature_blurbs.regard,
				colour: FEATURE_COLOURS_BY_KEY.regard
			},
			{
				key: 'reach',
				label: manifest.model.feature_labels.reach,
				blurb: manifest.model.feature_blurbs.reach,
				colour: FEATURE_COLOURS_BY_KEY.reach
			},
			{
				key: 'recognition',
				label: manifest.model.feature_labels.recognition,
				blurb: manifest.model.feature_blurbs.recognition,
				colour: FEATURE_COLOURS_BY_KEY.recognition
			}
		]
	};
}

export function formatRelativePosition(value: number): string {
	if (Math.abs(value) < 0.005) return 'At the eligible-author average.';
	return value > 0
		? `${value.toFixed(2)} above average.`
		: `${Math.abs(value).toFixed(2)} below average.`;
}
