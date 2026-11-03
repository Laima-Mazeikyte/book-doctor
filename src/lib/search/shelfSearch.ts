import Fuse from 'fuse.js';
import type { Book } from '$lib/types/book';

function normalize(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Literal alternatives let one adjacent letter swap count as one typo, even in short words. */
function adjacentSwaps(term: string): string[] {
	const letters = Array.from(term);
	const alternatives = new Set<string>();
	for (let i = 0; i < letters.length - 1; i++) {
		if (letters[i] === letters[i + 1]) continue;
		const swapped = [...letters];
		[swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
		alternatives.add(swapped.join(''));
	}
	return [...alternatives];
}

/** Build from shelf data, independently of the query and the selected sort order. */
export function createShelfSearch(books: readonly Pick<Book, 'id' | 'title' | 'author'>[]) {
	const entries = books.map((book) => {
		const title = normalize(book.title);
		const author = normalize(book.author);
		return {
			id: book.id,
			title,
			author,
			words: `${title} ${author}`.match(/[\p{L}\p{N}]+/gu) ?? []
		};
	});
	// Search each distinct word once, then resolve matching words back to books.
	const booksByWord = new Map<string, Set<string>>();
	for (const entry of entries) {
		for (const word of entry.words) {
			const ids = booksByWord.get(word) ?? new Set<string>();
			ids.add(entry.id);
			booksByWord.set(word, ids);
		}
	}
	const fuse = new Fuse([...booksByWord.keys()], {
		threshold: 0.34,
		ignoreLocation: true,
		shouldSort: false
	});

	return {
		/** Null means no filter; IDs let the page retain its own shelf sorting. */
		matchingIds(query: string): Set<string> | null {
			const normalized = normalize(query).trim();
			if (!normalized) return null;
			const terms = [...new Set(normalized.match(/[\p{L}\p{N}]+/gu) ?? [])];
			if (terms.length === 0) return new Set();

			let candidates = entries;
			for (const term of terms) {
				const literalOnly = Array.from(term).length <= 2;
				const fuzzyIds = new Set<string>();
				if (!literalOnly) {
					for (const { item: word } of fuse.search(term)) {
						// Short typo queries must resemble a whole word, not a fragment of a long name.
						if (term.length === 3 && Math.abs(word.length - term.length) > 1) continue;
						for (const id of booksByWord.get(word) ?? []) fuzzyIds.add(id);
					}
				}
				const literals = literalOnly ? [term] : [term, ...adjacentSwaps(term)];
				candidates = candidates.filter(
					(entry) =>
						fuzzyIds.has(entry.id) ||
						literals.some((text) => entry.title.includes(text) || entry.author.includes(text))
				);
				if (candidates.length === 0) break;
			}
			return new Set(candidates.map(({ id }) => id));
		}
	};
}
