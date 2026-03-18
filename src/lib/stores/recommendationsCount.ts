import { writable } from 'svelte/store';

/**
 * Total count of unique recommended books (from all recommendation runs).
 * Populated by the layout when the user is signed in.
 */
export const recommendationsCountStore = writable<number>(0);
