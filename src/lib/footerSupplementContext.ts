import { getContext, setContext } from 'svelte';
import { writable, type Readable } from 'svelte/store';

const FOOTER_SUPPLEMENT = Symbol('footerSupplement');

export interface FooterSupplementController {
	subscribe: Readable<string | null>['subscribe'];
	set(owner: symbol, text: string): void;
	clear(owner: symbol): void;
}

export function createFooterSupplementController(): FooterSupplementController {
	const value = writable<string | null>(null);
	let activeOwner: symbol | null = null;

	return {
		subscribe: value.subscribe,
		set(owner, text) {
			activeOwner = owner;
			value.set(text);
		},
		clear(owner) {
			if (activeOwner !== owner) return;
			activeOwner = null;
			value.set(null);
		}
	};
}

export function setFooterSupplementContext(controller: FooterSupplementController): void {
	setContext(FOOTER_SUPPLEMENT, controller);
}

export function getFooterSupplementContext(): FooterSupplementController | undefined {
	return getContext<FooterSupplementController | undefined>(FOOTER_SUPPLEMENT);
}
