<script lang="ts">
	import { onMount } from 'svelte';
	import type { Game } from '$game/engine';

	let { game }: { game: Game } = $props();

	let info = $state({
		state: 'airborne',
		vx: 0,
		vy: 0,
		vz: 0,
		speed: 0,
		grounded: false,
		slopeAngleDeg: 0,
		surface: 'air',
		fps: 60
	});

	let rafId = 0;

	onMount(() => {
		const tick = () => {
			info = game.getDebugInfo();
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	});

	const fmt = (n: number) => n.toFixed(2);
</script>

<div class="hud">
	<div class="row"><span class="k">state</span> <span class="v">{info.state}</span></div>
	<div class="row"><span class="k">surface</span> <span class="v">{info.surface}</span></div>
	<div class="row">
		<span class="k">vel</span>
		<span class="v">{fmt(info.vx)} {fmt(info.vy)} {fmt(info.vz)}</span>
	</div>
	<div class="row"><span class="k">speed</span> <span class="v">{fmt(info.speed)}</span></div>
	<div class="row"><span class="k">grnd</span> <span class="v">{info.grounded ? '✓' : '—'}</span></div>
	<div class="row"><span class="k">fps</span> <span class="v">{info.fps}</span></div>
</div>

<style>
	.hud {
		position: fixed;
		top: env(safe-area-inset-top, 10px);
		right: 10px;
		font-family: ui-monospace, Menlo, Consolas, monospace;
		font-size: 11px;
		background: rgba(10, 10, 26, 0.55);
		color: #cfe;
		padding: 6px 8px;
		border-radius: 6px;
		pointer-events: none;
		min-width: 140px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.k {
		opacity: 0.6;
	}
	.v {
		font-weight: 600;
	}
</style>
