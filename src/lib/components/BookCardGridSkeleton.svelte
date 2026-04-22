<script lang="ts">
	import BookCardSkeleton from '$lib/components/BookCardSkeleton.svelte';

	/** One count for the whole app’s book-card-grid loading states. */
	const DEFAULT_COUNT = 24;

	interface Props {
		class?: string;
		ariaLabel: string;
		ariaBusy?: boolean;
		ariaLive?: 'off' | 'polite' | 'assertive' | null;
		count?: number;
	}
	let {
		class: className = '',
		ariaLabel,
		ariaBusy = true,
		ariaLive = null,
		count = DEFAULT_COUNT
	}: Props = $props();

	const indices = $derived(Array.from({ length: count }, (_, i) => i));
</script>

<ul
	class="book-card-grid {className}"
	aria-label={ariaLabel}
	aria-busy={ariaBusy}
	aria-live={ariaLive ?? undefined}
>
	{#each indices as i (i)}
		<li><BookCardSkeleton /></li>
	{/each}
</ul>
