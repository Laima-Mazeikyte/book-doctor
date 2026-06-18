import { writable } from 'svelte/store';

function createShortlistSavePromptStore() {
	const { subscribe, set } = writable(false);

	return {
		subscribe,
		show() {
			set(true);
		},
		dismiss() {
			set(false);
		}
	};
}

export const shortlistSavePromptStore = createShortlistSavePromptStore();
