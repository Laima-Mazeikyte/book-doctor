// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			/** Shallow history layer: rate page book search overlay opened from toolbar. */
			rateSearchLayer?: boolean;
			/** Shallow layer: book summary sheet (grid or search) on /rate. */
			rateBookSummaryLayer?: boolean;
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
