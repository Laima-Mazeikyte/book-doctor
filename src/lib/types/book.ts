export interface Book {
	id: string;
	/** Integer business ID; required for persisting ratings to user_ratings. */
	book_id?: number;
	title: string;
	author: string;
	coverUrl?: string;
	summary?: string;
	year?: string;
}

export type RatingValue = 1 | 2 | 3 | 4 | 5;
