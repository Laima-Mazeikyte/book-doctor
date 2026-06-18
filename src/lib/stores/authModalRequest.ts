import { writable } from 'svelte/store';

export type AuthModalTab = 'signin' | 'signup';

type AuthModalRequest = {
	tab: AuthModalTab;
	nonce: number;
};

function createAuthModalRequestStore() {
	const { subscribe, set } = writable<AuthModalRequest | null>(null);

	return {
		subscribe,
		open(tab: AuthModalTab = 'signin') {
			set({ tab, nonce: Date.now() });
		},
		clear() {
			set(null);
		}
	};
}

export const authModalRequestStore = createAuthModalRequestStore();
