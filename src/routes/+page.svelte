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
	let game: Game | null = $state(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let panelOpen = $state(false);
	let comboReady = $state(false);
	let wallKickReady = $state(false);

	onMount(() => {
		if (!browser) return;
		let disposed = false;
		const cleanups: Array<() => void> = [];
		let pollRaf = 0;

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

				// Camera drag on full canvas. Touch-buttons sit on top with higher z.
				cleanups.push(bindCameraDrag(canvas, g));
				cleanups.push(bindWheelZoom(canvas, g));
				cleanups.push(bindPointerLock(canvas, g));

				const pollTick = () => {
					if (!game) return;
					const d = game.getDebugInfo();
					comboReady = d.comboReady;
					wallKickReady = d.wallKickReady;
					pollRaf = requestAnimationFrame(pollTick);
				};
				pollRaf = requestAnimationFrame(pollTick);

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
					cleanups.push(() => joy.destroy());

					bindHold(jumpZone, () => game?.inputRef.pressTouchJump(), () =>
						game?.inputRef.releaseTouchJump()
					);
					bindHold(crouchZone, () => game?.inputRef.pressTouchCrouch(), () =>
						game?.inputRef.releaseTouchCrouch()
					);
					bindTap(actionZone, () => game?.inputRef.pressTouchAction());
					cleanups.push(bindPinchZoom(canvas, g));
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
			if (e.code === 'KeyV') game?.toggleFirstPerson();
		};
		window.addEventListener('keydown', onKey);

		return () => {
			disposed = true;
			cancelAnimationFrame(pollRaf);
			for (const fn of cleanups) fn();
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

	function bindCameraDrag(el: HTMLElement, g: Game): () => void {
		let dragging = false;
		let lastX = 0;
		let lastY = 0;
		let accumX = 0;
		let accumY = 0;
		let activeId: number | null = null;

		const onDown = (e: PointerEvent) => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			dragging = true;
			activeId = e.pointerId;
			lastX = e.clientX;
			lastY = e.clientY;
			accumX = 0;
			accumY = 0;
			try {
				el.setPointerCapture(e.pointerId);
			} catch {}
		};
		const onMove = (e: PointerEvent) => {
			if (!dragging || e.pointerId !== activeId) return;
			const dx = e.clientX - lastX;
			const dy = e.clientY - lastY;
			lastX = e.clientX;
			lastY = e.clientY;
			accumX += dx;
			accumY += dy;
			if (Math.abs(accumX) > config.camDragDeadPx) {
				g.addYaw(accumX * config.camYawSensitivity);
				accumX = 0;
			}
			if (Math.abs(accumY) > config.camDragDeadPx) {
				g.addPitch(-accumY * config.camPitchSensitivity);
				accumY = 0;
			}
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
		return () => {
			el.removeEventListener('pointerdown', onDown);
			el.removeEventListener('pointermove', onMove);
			el.removeEventListener('pointerup', onUp);
			el.removeEventListener('pointercancel', onUp);
		};
	}

	function bindWheelZoom(el: HTMLElement, g: Game): () => void {
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const sign = Math.sign(e.deltaY);
			g.addZoom(sign * config.camZoomScrollSpeed);
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	}

	function bindPointerLock(el: HTMLElement, g: Game): () => void {
		const onContext = (e: Event) => {
			e.preventDefault();
			if (document.pointerLockElement === el) document.exitPointerLock();
			else el.requestPointerLock?.();
		};
		const onMouseMove = (e: MouseEvent) => {
			if (document.pointerLockElement !== el) return;
			g.addYaw(e.movementX * config.camYawSensitivity);
			g.addPitch(-e.movementY * config.camPitchSensitivity);
		};
		el.addEventListener('contextmenu', onContext);
		document.addEventListener('mousemove', onMouseMove);
		return () => {
			el.removeEventListener('contextmenu', onContext);
			document.removeEventListener('mousemove', onMouseMove);
		};
	}

	function bindPinchZoom(el: HTMLElement, g: Game): () => void {
		let lastDist = -1;
		const onTouchMove = (e: TouchEvent) => {
			if (e.touches.length !== 2) {
				lastDist = -1;
				return;
			}
			const a = e.touches[0];
			const b = e.touches[1];
			const d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
			if (lastDist > 0) {
				const delta = lastDist - d;
				g.addZoom(delta * config.camZoomPinchSensitivity);
			}
			lastDist = d;
		};
		const onTouchEnd = () => {
			lastDist = -1;
		};
		el.addEventListener('touchmove', onTouchMove, { passive: true });
		el.addEventListener('touchend', onTouchEnd);
		return () => {
			el.removeEventListener('touchmove', onTouchMove);
			el.removeEventListener('touchend', onTouchEnd);
		};
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
		WASD · space · shift long/back · E dive/pound · drag cam · wheel zoom · right-click lock · V 1st-person · C recenter · T · R
	</div>
</div>

{#if game}
	<DebugHud {game} />
	<TuningPanel bind:open={panelOpen} />
{/if}

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
		touch-action: none;
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
