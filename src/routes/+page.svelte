<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { Game } from '$game/engine';

	let canvas: HTMLCanvasElement;
	let joystickZone: HTMLDivElement;
	let jumpZone: HTMLDivElement;
	let game: Game | null = null;
	let loading = $state(true);
	let error = $state<string | null>(null);

	onMount(() => {
		if (!browser) return;
		let disposed = false;

		(async () => {
			try {
				const g = new Game(canvas);
				await g.init();
				if (disposed) {
					g.dispose();
					return;
				}
				game = g;
				g.start();
				loading = false;

				const isTouch = matchMedia('(pointer: coarse)').matches;
				if (isTouch) {
					const nip = await import('nipplejs');
					const joy = nip.default.create({
						zone: joystickZone,
						mode: 'static',
						position: { left: '80px', bottom: '80px' },
						color: 'white',
						size: 110
					});
					joy.on('move', (_e, data) => {
						if (!game) return;
						const f = data.force ?? 0;
						const clamped = Math.min(f, 1);
						const rad = data.angle.radian;
						const x = Math.cos(rad) * clamped;
						const z = -Math.sin(rad) * clamped;
						game.inputRef.setTouchMove(x, z);
					});
					joy.on('end', () => game?.inputRef.setTouchMove(0, 0));

					const onJumpDown = (e: Event) => {
						e.preventDefault();
						game?.inputRef.pressTouchJump();
					};
					const onJumpUp = (e: Event) => {
						e.preventDefault();
						game?.inputRef.releaseTouchJump();
					};
					jumpZone.addEventListener('touchstart', onJumpDown, { passive: false });
					jumpZone.addEventListener('touchend', onJumpUp, { passive: false });
					jumpZone.addEventListener('mousedown', onJumpDown);
					jumpZone.addEventListener('mouseup', onJumpUp);
				}
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
				loading = false;
			}
		})();

		return () => {
			disposed = true;
			game?.dispose();
		};
	});
</script>

<canvas bind:this={canvas}></canvas>

{#if loading}
	<div class="overlay">loading…</div>
{/if}
{#if error}
	<div class="overlay error">error: {error}</div>
{/if}

<div class="hud">
	<div class="title">skyhop</div>
	<div class="hint">WASD/arrows + space · mobile: joystick + tap right</div>
</div>

<div class="touch-zone joystick" bind:this={joystickZone}></div>
<div class="touch-zone jump" bind:this={jumpZone}>
	<div class="jump-label">JUMP</div>
</div>

<style>
	canvas {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		display: block;
	}
	.overlay {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(10, 10, 26, 0.8);
		color: #fff;
		font-size: 18px;
	}
	.overlay.error {
		color: #ff8080;
	}
	.hud {
		position: fixed;
		top: env(safe-area-inset-top, 10px);
		left: 12px;
		pointer-events: none;
	}
	.title {
		font-size: 20px;
		font-weight: 700;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
	}
	.hint {
		font-size: 11px;
		opacity: 0.7;
		margin-top: 2px;
	}
	.touch-zone {
		position: fixed;
		bottom: 0;
	}
	.joystick {
		left: 0;
		width: 45vw;
		height: 45vh;
		max-height: 260px;
	}
	.jump {
		right: 20px;
		bottom: 40px;
		width: 90px;
		height: 90px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15);
		border: 2px solid rgba(255, 255, 255, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		touch-action: none;
	}
	.jump-label {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 1px;
	}
	@media (pointer: fine) {
		.touch-zone {
			display: none;
		}
	}
</style>
