import { base } from '$app/paths';

export type AuthorOption = [name: string, bookCount: number];

let indexPromise: Promise<AuthorOption[]> | null = null;

/** The static catalog snapshot is downloaded only when author search is used. */
export function loadAuthorOptions(): Promise<AuthorOption[]> {
	if (!indexPromise) {
		indexPromise = fetch(`${base}/recommendation-authors.json`)
			.then(async (response) => {
				if (!response.ok) throw new Error('Could not load author options.');
				return (await response.json()) as AuthorOption[];
			})
			.catch((error) => {
				indexPromise = null;
				throw error;
			});
	}
	return indexPromise;
}

function normalized(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase();
}

/** Prefer a matching name/word start, then authors with more books in the catalog. */
export function searchAuthorOptions(options: AuthorOption[], query: string, limit = 24): string[] {
	const needle = normalized(query.trim());
	if (needle.length < 2) return [];
	return options
		.filter(([name]) => normalized(name).includes(needle))
		.sort((a, b) => {
			const rank = (name: string) => {
				const key = normalized(name);
				if (key.startsWith(needle)) return 0;
				if (key.split(/\s+/).some((word) => word.startsWith(needle))) return 1;
				return 2;
			};
			return rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]);
		})
		.slice(0, limit)
		.map(([name]) => name);
}
