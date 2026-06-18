import type { Book } from '$lib/types/book';

/** Config-driven sections for shortlist detail extensions (core layout uses BookSummarySheetBody). */
export type ShortlistMetaSection =
	| { kind: 'type' }
	| { kind: 'genres' }
	| { kind: 'year' }
	| { kind: 'custom'; id: string };

/** Extra metadata rendered around the sheet body; extend when adding new tags/UI. */
export const DEFAULT_SHORTLIST_META_SECTIONS: ShortlistMetaSection[] = [];

export function sectionVisible(section: ShortlistMetaSection, book: Book): boolean {
	switch (section.kind) {
		case 'type':
			return Boolean(book.type?.trim());
		case 'genres':
			return Boolean(book.genres && book.genres.length > 0);
		case 'year':
			return Boolean(book.year?.trim());
		case 'custom':
			return true;
		default: {
			const _x: never = section;
			return _x;
		}
	}
}
