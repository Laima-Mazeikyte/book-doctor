<script lang="ts">
</script>

<h1>Book Doctor</h1>
<p class="lead">Get personalized book recommendations. Rate at least 10 books you've read to get started.</p>
<p>
	<a href="/rate" class="cta">Start rating</a>
</p>

<style>
	h1 {
		font-size: 1.875rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		margin: 0 0 0.75rem 0;
	}
	.lead {
		margin: 0 0 1.5rem 0;
		color: var(--color-text-muted);
		font-size: 1rem;
		line-height: 1.6;
		max-width: 36ch;
	}
	.cta {
		display: inline-block;
		min-height: var(--min-tap);
		padding: 0.75rem 1.5rem;
		line-height: 1.5;
		font-weight: 500;
		font-size: 0.9375rem;
		text-decoration: none;
		background: var(--color-accent);
		color: #fff;
		border-radius: var(--radius-sm);
		transition: opacity 0.15s ease, transform 0.15s ease;
	}
	.cta:hover {
		opacity: 0.92;
	}
	.cta:focus-visible {
		outline-offset: 2px;
	}
</style>
