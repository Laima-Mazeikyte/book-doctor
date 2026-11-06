import { writable } from 'svelte/store';
import { FEED_BROWSE_CHECKPOINT } from './constants';

/** Layout-owned, memory-only checkpoint. No overscan, revisits, or disk tracking. */
export function createFeedBrowsingSession() {
	const store = writable({ encountered: 0, checkpoint: false });
	let encountered = 0;
	let seen = new Set<string>();
	let visible: string[] = [];

	return {
		subscribe: store.subscribe,
		observe(ids: string[]) {
			visible = ids;
			if (encountered >= FEED_BROWSE_CHECKPOINT) return;
			let changed = false;
			for (const id of ids) {
				if (seen.has(id)) continue;
				seen.add(id);
				encountered++;
				changed = true;
				if (encountered >= FEED_BROWSE_CHECKPOINT) break;
			}
			if (changed) store.set({ encountered, checkpoint: encountered >= FEED_BROWSE_CHECKPOINT });
		},
		interact() {
			// Cards already on screen are not newly encountered after this interaction.
			seen = new Set(visible);
			encountered = 0;
			store.set({ encountered: 0, checkpoint: false });
		},
		reset() {
			seen.clear();
			visible = [];
			encountered = 0;
			store.set({ encountered: 0, checkpoint: false });
		}
	};
}
