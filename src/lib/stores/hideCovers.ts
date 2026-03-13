import { writable } from 'svelte/store';

/**
 * When true, all book cards show the title/author placeholder instead of cover images.
 * Initial value is false; layout restores from localStorage on mount.
 */
export const hideCoversStore = writable<boolean>(false);
