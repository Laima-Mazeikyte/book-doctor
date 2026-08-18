import type { RankingResult } from './ranking-engine';

export function movementBetween(
	baseline: RankingResult | null,
	current: RankingResult | null,
	index: number
): number | null {
	if (!baseline || !current || baseline.revision === current.revision) return null;
	const before = baseline.rankByIndex[index];
	const after = current.rankByIndex[index];
	if (!before || !after) return null;
	return before === after ? 0 : before - after;
}

export function comparisonLabel(
	baseline: RankingResult | null,
	current: RankingResult | null
): string | null {
	return baseline && current && baseline.revision !== current.revision
		? `Compared with ${baseline.lens.displayName}`
		: null;
}
