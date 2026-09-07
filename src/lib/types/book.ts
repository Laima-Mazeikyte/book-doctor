export interface Book {
	id: string;
	/** ULID business/catalog ID; used for persistence and Bunny cover filenames. */
	book_id: string;
	title: string;
	author: string;
	coverUrl?: string;
	summary?: string;
	year?: string;
	/** Genre labels from `books.genre1`–`genre7` (catalog); slot order preserved. */
	genres?: string[];
	/** Catalog `books.type` when present; reserved for future UI. */
	type?: string;
	/** Authoritative public quality band; null means no public distinction. */
	qualityBand?: QualityBand | null;
}

export type RatingValue = 1 | 2 | 3 | 4 | 5;

export type QualityBand =
	| 'top_0_1_percent'
	| 'top_1_percent'
	| 'top_5_percent'
	| 'top_10_percent'
	| 'top_25_percent'
	| 'below_top_25';
