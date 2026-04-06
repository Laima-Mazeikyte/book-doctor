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

	interface Window {
		hcaptcha?: {
			render: (
				container: string | HTMLElement,
				params: Record<string, unknown> & {
					sitekey: string;
					size?: 'normal' | 'compact' | 'invisible';
					theme?: 'light' | 'dark';
					callback?: (token: string) => void;
					'error-callback'?: () => void;
					'expired-callback'?: () => void;
				}
			) => number;
			execute: (widgetId: number) => void;
			getResponse: (widgetId: number) => string;
			reset: (widgetId: number) => void;
			remove: (widgetId: number) => void;
		};
	}
}

declare module '*.yaml' {
	const value: Record<string, unknown>;
	export default value;
}

export {};
