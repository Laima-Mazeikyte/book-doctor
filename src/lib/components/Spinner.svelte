<script lang="ts">
	interface Props {
		size?: 'sm' | 'md';
	}

	let { size = 'md' }: Props = $props();
</script>

<span class="spinner spinner--{size}" aria-hidden="true"></span>

<style>
	.spinner {
		display: inline-block;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	.spinner--sm {
		width: var(--space-4);
		height: var(--space-4);
		border-width: 2px;
	}
	.spinner--md {
		width: var(--space-8);
		height: var(--space-8);
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
