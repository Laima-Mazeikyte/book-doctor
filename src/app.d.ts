// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			/** Selected bookshelf tab, kept with its shallow URL update. */
			bookshelfFilter?: 'rated' | 'bookmarked' | 'not-interested';
			/** Shallow layers: filtered recommendation editor and its tag picker. */
			filteredRecommendationDialog?: {
				url: string;
				layer: 'closed' | 'filters' | 'genres' | 'keywords';
			};
			/** Shallow history layer: rate page book search overlay opened from toolbar. */
			rateSearchLayer?: boolean;
			/** Shallow layer: the currently open book summary, shared by feed and lab pages. */
			bookSummarySheet?: { ownerId: string; bookUlid: string };
			/** Shallow layer: bookshelf / ratings drawer from bottom bar. */
			rateRatingsDrawer?: boolean;
			/** Shallow layer: book detail inside the ratings drawer. */
			rateRatingsDrawerDetail?: boolean;
		}
		// interface Platform {}
	}
}

declare module '*.yaml' {
	const value: Record<string, unknown>;
	export default value;
}

export {};
