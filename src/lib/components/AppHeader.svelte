<script lang="ts">
	interface Props {
		hideCovers?: boolean;
		onHideCoversChange?: (checked: boolean) => void;
	}

	let { hideCovers = false, onHideCoversChange }: Props = $props();

	function handleChange(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		onHideCoversChange?.(target.checked);
	}
</script>

<header class="app-header">
	<div class="app-header__inner">
		<label class="app-header__switch">
			<input
				type="checkbox"
				class="app-header__checkbox"
				checked={hideCovers}
				onchange={handleChange}
				aria-checked={hideCovers}
			/>
			<span class="app-header__switch-track" aria-hidden="true"></span>
			<span class="app-header__label">Hide cover images</span>
		</label>
	</div>
</header>

<style>
	.app-header {
		background: var(--color-card-bg);
		border-bottom: 1px solid var(--color-border);
	}
	.app-header__inner {
		max-width: var(--content-width-narrow);
		margin: 0 auto;
		padding: var(--space-3) var(--space-4);
		display: flex;
		align-items: center;
	}
	@media (min-width: 768px) {
		.app-header__inner {
			max-width: var(--content-width-wide);
		}
	}
	.app-header__switch {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		font-size: var(--font-size-sm);
		color: var(--color-text);
		user-select: none;
	}
	.app-header__checkbox {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	.app-header__switch-track {
		position: relative;
		width: 2.5rem;
		height: 1.375rem;
		background: var(--color-bg-muted);
		border-radius: var(--radius-pill);
		transition: background var(--duration-normal) var(--ease-default);
	}
	.app-header__switch-track::after {
		content: '';
		position: absolute;
		inset: 2px 0 2px 0;
		width: 1.125rem;
		border-radius: 50%;
		background: var(--color-card-bg);
		box-shadow: var(--shadow-toggle);
		left: 2px;
		transition: transform var(--duration-normal) var(--ease-default);
	}
	.app-header__checkbox:checked + .app-header__switch-track {
		background: var(--color-accent-bg);
	}
	.app-header__checkbox:checked + .app-header__switch-track::after {
		transform: translateX(1.125rem);
	}
	.app-header__checkbox:focus-visible + .app-header__switch-track {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.app-header__label {
		flex: 1;
	}
</style>
