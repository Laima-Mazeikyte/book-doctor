import type { QualityBand } from '$lib/types/book';

export const VISIBLE_QUALITY_BANDS = [
	'top_0_1_percent',
	'top_1_percent',
	'top_5_percent',
	'top_10_percent',
	'top_25_percent'
] as const satisfies readonly QualityBand[];

const QUALITY_BANDS = new Set<string>([...VISIBLE_QUALITY_BANDS, 'below_top_25']);

/** Fail closed when a release contains an unknown text value. */
export function normalizeQualityBand(value: unknown): QualityBand | null {
	if (typeof value !== 'string') return null;
	const band = value.trim();
	return QUALITY_BANDS.has(band) ? (band as QualityBand) : null;
}

/** Only the mutually exclusive visible bands receive a UI distinction. */
export function isVisibleQualityBand(
	value: QualityBand | null | undefined
): value is (typeof VISIBLE_QUALITY_BANDS)[number] {
	return value != null && (VISIBLE_QUALITY_BANDS as readonly string[]).includes(value);
}
