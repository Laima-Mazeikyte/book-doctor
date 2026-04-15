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
		}
		// interface Platform {}
	}
}

declare module '*.yaml' {
	const value: Record<string, unknown>;
	export default value;
}

export {};
