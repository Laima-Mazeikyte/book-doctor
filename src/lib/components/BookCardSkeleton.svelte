<script lang="ts">
	// Plain white card placeholder matching BookCard size – no content.
</script>

<article class="book-card-skeleton" aria-hidden="true"></article>

<style>
	.book-card-skeleton {
		aspect-ratio: 2 / 3;
		width: 100%;
		min-height: 12rem;
		border-radius: var(--radius);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	}
</style>
