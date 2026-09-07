import type { Book } from '$lib/types/book';

export type NotInterestedOrder = 'newest' | 'oldest';

export interface NotInterestedCursor {
	version: 1;
	order: NotInterestedOrder;
	createdAt: string;
	bookId: string;
}

export interface NotInterestedPage {
	books: Book[];
	nextCursor: string | null;
}

export interface NotInterestedPageState {
	books: Book[];
	nextCursor: string | null;
	loaded: boolean;
	loading: boolean;
	error: string | null;
}

export interface NotInterestedLoaderSnapshot {
	accountId: string | null;
	entries: Record<NotInterestedOrder, NotInterestedPageState>;
}
