<script lang="ts">
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
				tabindex={selectedId === item.id ? 0 : -1}
				onclick={() => handleSelect(item.id)}
			>
				{item.label}
				<span class="nav-style-tabs__count" aria-hidden={!countsReady}>
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
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}
	.nav-style-tabs__list {
		display: flex;
		flex-wrap: nowrap;
		gap: var(--space-1);
		min-width: min-content;
		margin: 0;
		justify-content: flex-start;
		width: fit-content;
		max-width: 100%;
		padding: 0;
		box-sizing: border-box;
	}
	.nav-style-tabs__tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
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
		white-space: nowrap;
		transition: color 0.15s ease, background 0.15s ease;
	}
	.nav-style-tabs__tab:hover {
		color: var(--color-text);
		background: var(--color-bg-muted);
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
		background: var(--color-bg-muted);
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
	}
	.nav-style-tabs__tab--active .nav-style-tabs__count {
		color: var(--color-text);
	}
	.nav-style-tabs__spinner {
		display: inline-flex;
		vertical-align: middle;
	}
</style>
