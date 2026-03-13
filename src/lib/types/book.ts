export interface Book {
	id: string;
	title: string;
	author: string;
	coverUrl?: string;
	summary?: string;
}

export type RatingValue = 1 | 2 | 3 | 4 | 5;
