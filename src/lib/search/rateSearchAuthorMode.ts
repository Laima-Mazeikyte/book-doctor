export type RateSearchMode = 'fulltext' | 'author';

/**
 * When the user edits the search input away from the clicked author anchor,
 * author mode should fall back to fuzzy typed search (`q`).
 */
export function nextRateSearchModeAfterQueryChange(
	currentMode: RateSearchMode,
	authorSearchAnchor: string,
	searchQuery: string
): RateSearchMode {
	const q = searchQuery.trim();
	if (currentMode === 'author' && q.toLowerCase() !== authorSearchAnchor.toLowerCase()) {
		return 'fulltext';
	}
	return currentMode;
}
