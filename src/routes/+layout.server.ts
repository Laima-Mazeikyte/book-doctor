import type { LayoutServerLoad } from './$types';

// Serialized with the document so error quotes agree before and after hydration.
// No URL dependency: ordinary client navigation can reuse this layout data.
export const load: LayoutServerLoad = () => ({
	errorQuoteSeed: Math.floor(Math.random() * 0x1_0000_0000)
});
