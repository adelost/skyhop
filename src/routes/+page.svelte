<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { Game } from '$game/engine';
	import { config } from '$game/config.svelte';
	import DebugHud from '$hud/debug-hud.svelte';
	import TuningPanel from '$hud/tuning-panel.svelte';

	let canvas: HTMLCanvasElement;
	let joystickZone: HTMLDivElement;
	let jumpZone: HTMLDivElement;
	let crouchZone: HTMLDivElement;
	let actionZone: HTMLDivElement;
	let camZone: HTMLDivElement;
	let game: Game | null = $state(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let panelOpen = $state(false);
	let comboReady = $state(false);
	let wallKickReady = $state(false);

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

				// Camera drag zone (both mouse + touch via pointer events)
				bindCameraDrag(camZone, g);

				// Combo-ready polling for JUMP glow
				const pollTick = () => {
					if (!game) return;
					const d = game.getDebugInfo();
					comboReady = d.comboReady;
					wallKickReady = d.wallKickReady;
					requestAnimationFrame(pollTick);
				};
				requestAnimationFrame(pollTick);

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
			if (e.code === 'KeyC') game?.recenterCam();
			if (e.code === 'KeyQ') game?.addYaw(-0.1);
			if (e.code === 'KeyX') game?.addYaw(0.1);
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
			e.stopPropagation();
			down();
		};
		const u = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
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
			e.stopPropagation();
			tap();
		};
		el.addEventListener('touchstart', fn, { passive: false });
		el.addEventListener('mousedown', fn);
	}

	function bindCameraDrag(el: HTMLElement, g: Game) {
		let dragging = false;
		let lastX = 0;
		let activeId: number | null = null;

		const onDown = (e: PointerEvent) => {
			if (e.target !== el) return; // don't steal from buttons
			dragging = true;
			activeId = e.pointerId;
			lastX = e.clientX;
			el.setPointerCapture(e.pointerId);
		};
		const onMove = (e: PointerEvent) => {
			if (!dragging || e.pointerId !== activeId) return;
			const dx = e.clientX - lastX;
			lastX = e.clientX;
			g.addYaw(dx * config.camYawSensitivity);
		};
		const onUp = (e: PointerEvent) => {
			if (e.pointerId !== activeId) return;
			dragging = false;
			activeId = null;
			try {
				el.releasePointerCapture(e.pointerId);
			} catch {}
		};
		el.addEventListener('pointerdown', onDown);
		el.addEventListener('pointermove', onMove);
		el.addEventListener('pointerup', onUp);
		el.addEventListener('pointercancel', onUp);
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
	<div class="hint">
		WASD · space · shift long/back · shift+run=slide · E dive/pound · up=ledge-pull · Q/X/C cam · T · R
	</div>
</div>

{#if game}
	<DebugHud {game} />
	<TuningPanel bind:open={panelOpen} />
{/if}

<div class="cam-zone" bind:this={camZone}></div>
<div class="touch-zone joystick" bind:this={joystickZone}></div>
<div
	class="touch-btn jump"
	class:glow-combo={comboReady}
	class:glow-wall={wallKickReady}
	bind:this={jumpZone}
>
	JUMP
</div>
<div class="touch-btn crouch" bind:this={crouchZone}>DUCK</div>
<div class="touch-btn action" bind:this={actionZone}>ACT</div>
<button class="cam-recenter" onclick={() => game?.recenterCam()} aria-label="recenter cam">↺</button>

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
		max-width: 60vw;
	}
	.title {
		font-size: 20px;
		font-weight: 700;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
	}
	.hint {
		font-size: 10px;
		opacity: 0.7;
		margin-top: 2px;
	}
	.cam-zone {
		position: fixed;
		top: 0;
		right: 0;
		width: 55vw;
		height: 100vh;
		touch-action: none;
		z-index: 1;
	}
	.touch-zone {
		position: fixed;
		bottom: 0;
		z-index: 5;
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
		z-index: 10;
		transition: box-shadow 0.12s, background 0.12s, border-color 0.12s;
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
	.glow-combo {
		background: rgba(255, 220, 80, 0.45);
		border-color: rgba(255, 220, 80, 1);
		box-shadow: 0 0 24px rgba(255, 220, 80, 0.9), 0 0 4px rgba(255, 220, 80, 1) inset;
	}
	.glow-wall {
		background: rgba(180, 100, 255, 0.4);
		border-color: rgba(200, 140, 255, 1);
		box-shadow: 0 0 20px rgba(200, 140, 255, 0.9);
	}
	.cam-recenter {
		position: fixed;
		top: env(safe-area-inset-top, 10px);
		right: 160px;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: rgba(10, 10, 26, 0.55);
		color: #cfe;
		border: 1px solid rgba(255, 255, 255, 0.3);
		font-size: 16px;
		cursor: pointer;
		z-index: 15;
		touch-action: manipulation;
	}
	@media (pointer: fine) {
		.touch-zone,
		.touch-btn {
			display: none;
		}
	}
</style>
