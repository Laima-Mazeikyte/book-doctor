<script lang="ts">
	interface Props {
		value?: string;
		placeholder?: string;
		'aria-label'?: string;
		oninput?: (e: Event) => void;
	}

	let {
		value = $bindable(''),
		placeholder = 'Search books',
		'aria-label': ariaLabel = 'Search books',
		oninput,
	}: Props = $props();
</script>

<div class="search-bar">
	<span class="search-bar__icon" aria-hidden="true">
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="11" cy="11" r="8"/>
			<path d="m21 21-4.35-4.35"/>
		</svg>
	</span>
	<input
		type="search"
		autocomplete="off"
		{placeholder}
		aria-label={ariaLabel}
		bind:value
		oninput={oninput}
		class="search-bar__input"
	/>
</div>

<style>
	.search-bar {
		position: relative;
	}
	.search-bar__icon {
		position: absolute;
		left: var(--space-4);
		top: 50%;
		transform: translateY(-50%);
		z-index: 1;
		color: var(--color-text-muted);
		pointer-events: none;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.search-bar__input {
		width: 100%;
		min-height: var(--min-tap);
		padding: var(--space-3) var(--space-4) var(--space-3) var(--space-input-icon-left);
		font-size: var(--font-size-base);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-card-bg);
		color: var(--color-text);
		box-shadow: var(--shadow-input);
		transition: border-color var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default);
	}
	@media (prefers-color-scheme: dark) {
		.search-bar__input {
			box-shadow: var(--shadow-input);
		}
	}
	.search-bar__input:focus {
		outline: none;
		border-color: var(--color-focus);
		box-shadow: var(--shadow-focus-input);
	}
</style>
