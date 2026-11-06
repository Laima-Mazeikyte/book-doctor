/** The cover grid needs no full catalog metadata or internal UUID. */
export interface AuthorBookSummary {
	book_id: string;
	slug: string;
	title: string;
}

export interface AuthorBooksResponse {
	books: AuthorBookSummary[];
	truncated: boolean;
}
