import { SvelteURL } from 'svelte/reactivity';

export const pageState = $state<{ url: URL; state: App.PageState }>({
	url: new SvelteURL('http://localhost/discover'),
	state: {}
});
