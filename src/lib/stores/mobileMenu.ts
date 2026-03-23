import { writable } from 'svelte/store';

/** True while the hamburger mobile nav drawer is open (< md breakpoint). */
export const mobileMenuOpen = writable(false);
