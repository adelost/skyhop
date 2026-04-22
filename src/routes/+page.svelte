<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { Game } from '$game/engine';
	import DebugHud from '$hud/debug-hud.svelte';
	import TuningPanel from '$hud/tuning-panel.svelte';

	let canvas: HTMLCanvasElement;
	let joystickZone: HTMLDivElement;
	let jumpZone: HTMLDivElement;
	let crouchZone: HTMLDivElement;
	let actionZone: HTMLDivElement;
	let game: Game | null = $state(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let panelOpen = $state(false);

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

					bindHold(jumpZone, () => game?.inputRef.pressTouchJump(), () =>
						game?.inputRef.releaseTouchJump()
					);
					bindHold(crouchZone, () => game?.inputRef.pressTouchCrouch(), () =>
						game?.inputRef.releaseTouchCrouch()
					);
					bindTap(actionZone, () => game?.inputRef.pressTouchAction());
				}
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
				loading = false;
			}
		})();

		const onKey = (e: KeyboardEvent) => {
			if (e.code === 'KeyT') panelOpen = !panelOpen;
			if (e.code === 'KeyR') game?.respawn();
		};
		window.addEventListener('keydown', onKey);

		return () => {
			disposed = true;
			game?.dispose();
			window.removeEventListener('keydown', onKey);
		};
	});

	function bindHold(el: HTMLElement, down: () => void, up: () => void) {
		const d = (e: Event) => {
			e.preventDefault();
			down();
		};
		const u = (e: Event) => {
			e.preventDefault();
			up();
		};
		el.addEventListener('touchstart', d, { passive: false });
		el.addEventListener('touchend', u, { passive: false });
		el.addEventListener('touchcancel', u, { passive: false });
		el.addEventListener('mousedown', d);
		el.addEventListener('mouseup', u);
	}

	function bindTap(el: HTMLElement, tap: () => void) {
		const fn = (e: Event) => {
			e.preventDefault();
			tap();
		};
		el.addEventListener('touchstart', fn, { passive: false });
		el.addEventListener('mousedown', fn);
	}
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
	<div class="hint">WASD · space jump · shift crouch · E action · T tune · R respawn</div>
</div>

{#if game}
	<DebugHud {game} />
	<TuningPanel bind:open={panelOpen} />
{/if}

<div class="touch-zone joystick" bind:this={joystickZone}></div>
<div class="touch-btn jump" bind:this={jumpZone}>JUMP</div>
<div class="touch-btn crouch" bind:this={crouchZone}>DUCK</div>
<div class="touch-btn action" bind:this={actionZone}>ACT</div>

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
		color: #fff;
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
	.touch-btn {
		position: fixed;
		width: 80px;
		height: 80px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15);
		border: 2px solid rgba(255, 255, 255, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		touch-action: none;
		color: #fff;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 1px;
		user-select: none;
	}
	.jump {
		right: 20px;
		bottom: 40px;
	}
	.action {
		right: 110px;
		bottom: 40px;
		background: rgba(255, 150, 100, 0.2);
		border-color: rgba(255, 150, 100, 0.6);
	}
	.crouch {
		right: 20px;
		bottom: 130px;
		background: rgba(100, 180, 255, 0.2);
		border-color: rgba(100, 180, 255, 0.6);
	}
	@media (pointer: fine) {
		.touch-zone,
		.touch-btn {
			display: none;
		}
	}
</style>
