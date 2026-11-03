<script lang="ts">
	import { Select } from 'bits-ui';
	import { Check, ChevronDown } from 'lucide-svelte';

	interface Props {
		options: { value: string; label: string }[];
		value: string;
		ariaLabel: string;
		onChange: (value: string) => void;
	}

	let { options, value, ariaLabel, onChange }: Props = $props();
	const selectedLabel = $derived(options.find((option) => option.value === value)?.label ?? '');
</script>

<Select.Root type="single" {value} items={options} onValueChange={onChange} allowDeselect={false}>
	<Select.Trigger aria-label={ariaLabel}>
		{#snippet child({ props })}
			<button {...props} class="shelf-sort__trigger">
				<span>{selectedLabel}</span>
				<ChevronDown size={18} strokeWidth={2} aria-hidden="true" />
			</button>
		{/snippet}
	</Select.Trigger>
	<Select.Portal>
		<Select.Content align="start" sideOffset={4} collisionPadding={8}>
			{#snippet child({ props, wrapperProps })}
				<div {...wrapperProps}>
					<div {...props} class="shelf-sort__menu" aria-label={ariaLabel}>
						{#each options as option (option.value)}
							<Select.Item value={option.value} label={option.label}>
								{#snippet child({ props, selected })}
									<div {...props} class="shelf-sort__option">
										<span>{option.label}</span>
										{#if selected}
											<span class="shelf-sort__check" aria-hidden="true"><Check size={14} /></span>
										{/if}
									</div>
								{/snippet}
							</Select.Item>
						{/each}
					</div>
				</div>
			{/snippet}
		</Select.Content>
	</Select.Portal>
</Select.Root>

<style>
	.shelf-sort__trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		max-width: 100%;
		margin: 0;
		padding: var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		white-space: nowrap;
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition:
			color 0.15s ease,
			background 0.15s ease;
	}
	.shelf-sort__trigger:hover {
		color: var(--color-text);
		background: var(--color-interactive-hover-subtle);
	}
	.shelf-sort__trigger:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.shelf-sort__menu {
		z-index: 100;
		width: max-content;
		max-width: calc(100vw - var(--space-4));
		max-height: min(24rem, var(--bits-select-content-available-height, 24rem));
		overflow-y: auto;
		padding: var(--space-1);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-input);
	}
	.shelf-sort__option {
		position: relative;
		display: flex;
		align-items: center;
		padding: var(--space-2) var(--space-8) var(--space-2) var(--space-3);
		white-space: nowrap;
		color: inherit;
		border-radius: var(--radius-sm);
		cursor: pointer;
		user-select: none;
	}
	.shelf-sort__option[data-selected] {
		background: var(--color-accent-bg);
	}
	.shelf-sort__option[data-highlighted] {
		background: var(--color-interactive-hover-subtle);
	}
	.shelf-sort__check {
		position: absolute;
		right: var(--space-3);
		display: flex;
	}
	@media (pointer: coarse) {
		.shelf-sort__option {
			min-height: var(--min-tap);
		}
	}
</style>
