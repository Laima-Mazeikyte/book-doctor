<script lang="ts">
	import Hero from '$lib/components/Hero.svelte';
	import Button from '$lib/components/Button.svelte';
</script>

<Hero
	title="Book Doctor"
	lead="Get personalized book recommendations. Rate at least 10 books you've read to get started."
>
	<Button href="/rate">Start rating</Button>
</Hero>
