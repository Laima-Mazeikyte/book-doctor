<script lang="ts">
	import { tick } from 'svelte';
	import Spinner from '$lib/components/Spinner.svelte';

	interface NavStyleTabItem {
		id: string;
		label: string;
	}

	interface Props {
		/** Tabs in display order (left → right). */
		items: NavStyleTabItem[];
		/** Id of the selected tab (must match an `items[].id`). */
		selectedId: string;
		/** Accessible name for the tablist. */
		ariaLabel: string;
		/** `id` of the controlled `tabpanel` element. */
		panelId: string;
		/** Prefix for each tab button `id` (`${idPrefix}-${item.id}`). */
		idPrefix?: string;
		/** When false, counts are replaced by a small spinner (per-tab). */
		countsReady?: boolean;
		/** Return numeric count for a tab id (shown as `(n)`). */
		getCount?: (id: string) => number;
		onSelect?: (id: string) => void;
	}

	let {
		items,
		selectedId,
		ariaLabel,
		panelId,
		idPrefix = 'tab',
		countsReady = true,
		getCount = () => 0,
		onSelect
	}: Props = $props();

	function handleSelect(id: string) {
		onSelect?.(id);
	}

	function tabDomId(id: string) {
		return `${idPrefix}-${id}`;
	}

	async function activateTabAtIndex(nextIndex: number) {
		const len = items.length;
		if (len === 0) return;
		const wrapped = ((nextIndex % len) + len) % len;
		const next = items[wrapped];
		if (!next) return;
		handleSelect(next.id);
		await tick();
		document.getElementById(tabDomId(next.id))?.focus();
	}

	function handleTabKeydown(e: KeyboardEvent, itemId: string) {
		if (itemId !== selectedId) return;

		const idx = items.findIndex((i) => i.id === selectedId);
		if (idx < 0) return;

		const rtl = document.documentElement.dir === 'rtl';

		if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			const forward = e.key === 'ArrowRight' ? !rtl : rtl;
			void activateTabAtIndex(forward ? idx + 1 : idx - 1);
			return;
		}
		if (e.key === 'Home') {
			e.preventDefault();
			void activateTabAtIndex(0);
			return;
		}
		if (e.key === 'End') {
			e.preventDefault();
			void activateTabAtIndex(items.length - 1);
		}
	}

	function tabAriaLabel(item: NavStyleTabItem): string {
		if (!countsReady) return item.label;
		return `${item.label} (${getCount(item.id)})`;
	}
</script>

<div class="nav-style-tabs__wrap">
	<div class="nav-style-tabs__list" role="tablist" aria-label={ariaLabel}>
		{#each items as item (item.id)}
			<button
				type="button"
				id="{idPrefix}-{item.id}"
				class="nav-style-tabs__tab"
				class:nav-style-tabs__tab--active={selectedId === item.id}
				role="tab"
				aria-selected={selectedId === item.id}
				aria-controls={panelId}
				aria-label={tabAriaLabel(item)}
				tabindex={selectedId === item.id ? 0 : -1}
				onclick={() => handleSelect(item.id)}
				onkeydown={(e) => handleTabKeydown(e, item.id)}
			>
				<span class="nav-style-tabs__tab-label">{item.label}</span>
				<span
					class="nav-style-tabs__count"
					class:nav-style-tabs__count--triple={countsReady && getCount(item.id) >= 100}
					aria-hidden="true"
				>
					{#if !countsReady}
						<span class="nav-style-tabs__spinner"><Spinner size="sm" /></span>
					{:else}
						({getCount(item.id)})
					{/if}
				</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.nav-style-tabs__wrap {
		overflow-x: visible;
		width: 100%;
	}
	.nav-style-tabs__list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0;
		justify-content: flex-start;
		width: 100%;
		padding: 0;
		box-sizing: border-box;
	}
	.nav-style-tabs__tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		flex: 0 1 auto;
		min-width: 0;
		max-width: 100%;
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
		margin: 0;
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition: color 0.15s ease, background 0.15s ease;
	}
	.nav-style-tabs__tab-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nav-style-tabs__tab:hover {
		color: var(--color-text);
		background: var(--color-interactive-hover-subtle);
	}
	.nav-style-tabs__tab:hover .nav-style-tabs__count {
		color: var(--color-text);
	}
	.nav-style-tabs__tab--active {
		background: var(--color-accent-bg);
		color: var(--color-text);
		font-weight: var(--typ-interactive-2-font-weight);
	}
	.nav-style-tabs__tab--active:hover {
		color: var(--color-text);
		background: var(--color-interactive-hover-on-accent);
	}
	.nav-style-tabs__tab:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.nav-style-tabs__count {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-weight: var(--font-weight-normal);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}
	/** Visually clip (100)–(999); full count remains on the tab `aria-label`. */
	.nav-style-tabs__count--triple {
		max-width: 3.35rem;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		display: inline-block;
		vertical-align: bottom;
		text-align: end;
	}
	.nav-style-tabs__tab--active .nav-style-tabs__count {
		color: var(--color-text);
	}
	.nav-style-tabs__spinner {
		display: inline-flex;
		vertical-align: middle;
	}
</style>
