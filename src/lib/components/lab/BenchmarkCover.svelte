<script lang="ts">
	import { coverUrlForBookIdAtSize } from '$lib/book-cover';

	interface Props {
		/** Catalog id; null for a comparator's book we could not match to the catalog. */
		bookId: string | null;
		title: string;
		/** `large` loads the full-size image, for the revealed hidden favorite. */
		large?: boolean;
	}

	let { bookId, title, large = false }: Props = $props();

	let failed = $state(false);
	const src = $derived(bookId ? coverUrlForBookIdAtSize(bookId, large ? 720 : 200) : undefined);

	// A different book gets a fresh attempt at its image.
	$effect(() => {
		void src;
		failed = false;
	});
</script>

<!--
	Decorative: the surrounding control carries the title for assistive technology. Without an
	image, the title itself is set on the placeholder so the cover still identifies the book.
-->
<span class="benchmark-cover" class:benchmark-cover--large={large} aria-hidden="true">
	{#if src && !failed}
		<img {src} alt="" loading="lazy" decoding="async" onerror={() => (failed = true)} />
	{:else}
		<span class="benchmark-cover__title">{title}</span>
	{/if}
</span>

<style>
	.benchmark-cover {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 2 / 3;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xs);
		background: var(--color-card-placeholder-bg);
	}
	.benchmark-cover img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform var(--duration-normal) var(--ease-default);
	}
	.benchmark-cover__title {
		display: -webkit-box;
		overflow: hidden;
		/* Top padding clears the rank badge that sits in the corner of list covers. */
		padding: 1.5rem 0.3rem 0.3rem;
		font-family: var(--font-family-content);
		font-size: 0.5625rem;
		line-height: 1.25;
		color: var(--color-text-muted);
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 6;
		line-clamp: 6;
		overflow-wrap: anywhere;
		transform-origin: center center;
		transition: transform var(--duration-normal) var(--ease-default);
	}
	@media (prefers-reduced-motion: reduce) {
		.benchmark-cover img,
		.benchmark-cover__title {
			transition: none;
		}
	}
	.benchmark-cover--large .benchmark-cover__title {
		padding: 0.5rem;
		font-size: 0.8125rem;
		-webkit-line-clamp: 8;
		line-clamp: 8;
	}
</style>
