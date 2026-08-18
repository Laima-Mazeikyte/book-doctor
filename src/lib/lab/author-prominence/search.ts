export interface AuthorSearchEntry {
	index: number;
	name: string;
	full: string;
	diacriticFree: string;
	tokens: string[];
}

function normalize(value: string, stripDiacritics = true): string {
	return value
		.normalize(stripDiacritics ? 'NFKD' : 'NFC')
		.replace(stripDiacritics ? /[\u0300-\u036f]/g : /$^/g, '')
		.toLocaleLowerCase()
		.replace(/[’']/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

export function buildAuthorSearchIndex(names: string[]): AuthorSearchEntry[] {
	return names.map((name, index) => {
		const full = normalize(name, false);
		const diacriticFree = normalize(name, true);
		return {
			index,
			name,
			full,
			diacriticFree,
			tokens: diacriticFree ? diacriticFree.split(' ') : []
		};
	});
}

export function searchAuthors(
	index: AuthorSearchEntry[],
	query: string,
	rankByIndex: ArrayLike<number>,
	limit = 8
): number[] {
	const needle = normalize(query, false);
	const diacriticFreeNeedle = normalize(query, true);
	if (!needle) return [];
	const queryTokens = diacriticFreeNeedle.split(' ');
	const matches: Array<{ entry: AuthorSearchEntry; group: number }> = [];
	for (const entry of index) {
		const exactFull = entry.full === needle || entry.diacriticFree === diacriticFreeNeedle;
		const fullPrefix =
			entry.full.startsWith(needle) || entry.diacriticFree.startsWith(diacriticFreeNeedle);
		const exactToken = entry.tokens.some((token) => token === diacriticFreeNeedle);
		const tokenPrefix =
			queryTokens.length === 1 &&
			entry.tokens.some((token) => token.startsWith(diacriticFreeNeedle));
		const boundarySubstring = entry.tokens.some((token) => token.includes(diacriticFreeNeedle));
		const generalSubstring =
			entry.full.includes(needle) || entry.diacriticFree.includes(diacriticFreeNeedle);
		const group = exactFull
			? 0
			: fullPrefix
				? 1
				: exactToken
					? 2
					: tokenPrefix
						? 3
						: boundarySubstring
							? 4
							: generalSubstring
								? 5
								: -1;
		if (group >= 0) matches.push({ entry, group });
	}
	matches.sort(
		(a, b) =>
			a.group - b.group ||
			(rankByIndex[a.entry.index] || Number.MAX_SAFE_INTEGER) -
				(rankByIndex[b.entry.index] || Number.MAX_SAFE_INTEGER) ||
			a.entry.name.localeCompare(b.entry.name)
	);
	return matches.slice(0, limit).map(({ entry }) => entry.index);
}

export { normalize as normalizeAuthorName };
