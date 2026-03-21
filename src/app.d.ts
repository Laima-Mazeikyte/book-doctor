// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window {
		hcaptcha?: {
			render: (
				container: string | HTMLElement,
				params: { sitekey: string; theme?: 'light' | 'dark' }
			) => number;
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
