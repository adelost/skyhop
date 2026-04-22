<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<title>skyhop</title>
</svelte:head>

{@render children()}

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: #0a0a1a;
		width: 100%;
		height: 100%;
		touch-action: none;
		overscroll-behavior: none;
		-webkit-user-select: none;
		user-select: none;
	}
	:global(body) {
		font-family: system-ui, sans-serif;
		color: #fff;
	}
</style>
