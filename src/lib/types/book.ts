export interface Book {
	id: string;
	/** Integer business ID; required for persisting ratings to user_ratings. */
	book_id?: number;
	title: string;
	author: string;
	coverUrl?: string;
	summary?: string;
	year?: string;
	/** Genre labels from `books.genre1`–`genre7` (catalog); slot order preserved. */
	genres?: string[];
	/** Catalog `books.type` when present; reserved for future UI. */
	type?: string;
}

export type RatingValue = 1 | 2 | 3 | 4 | 5;
