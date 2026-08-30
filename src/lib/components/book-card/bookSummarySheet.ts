import type { Book } from '$lib/types/book';

export interface BookSummaryIdentity {
	bookUlid: string;
	title: string;
}

export interface BookSummarySheetCloseOptions {
	skipFlyOut?: boolean;
	fromHistoryApply?: boolean;
}

export type BookSummarySheetState =
	| { kind: 'closed' }
	| {
			kind: 'loading';
			identity: BookSummaryIdentity;
			trigger: HTMLElement;
	  }
	| {
			kind: 'ready';
			book: Book;
			trigger: HTMLElement;
	  }
	| {
			kind: 'error';
			identity: BookSummaryIdentity;
			message: string;
			trigger: HTMLElement;
	  };

export function bookSummaryIdentity(book: Book): BookSummaryIdentity {
	return {
		bookUlid: book.book_id,
		title: book.title
	};
}
