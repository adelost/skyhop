import * as THREE from 'three';
import { createPhysics, type Physics } from './physics';
import { Input } from './input';
import { buildWorld, updateMovingPlatforms, type MovingPlatform } from './world';
import { Player, type DebugInfo } from './player';
import { config } from './config.svelte';

const FIXED_DT = 1 / 60;
const MAX_STEPS = 5;

export class Game {
	private renderer: THREE.WebGLRenderer;
	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera;
	private physics!: Physics;
	private player!: Player;
	private input = new Input();
	private movingPlatforms: MovingPlatform[] = [];

	private running = false;
	private accumulator = 0;
	private lastTime = 0;
	private rafId = 0;
	private simTime = 0;
	private fpsSamples: number[] = [];
	private lastFps = 60;

	private cameraTarget = new THREE.Vector3();
	private cameraYaw = 0;
	private timeSinceCamInput = 999;

	constructor(canvas: HTMLCanvasElement) {
		const isMobile = matchMedia('(pointer: coarse)').matches;
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: !isMobile,
			powerPreference: 'high-performance'
		});
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;

		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(0x6fb8e0);
		this.scene.fog = new THREE.Fog(0x6fb8e0, 35, 100);

		this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);

		const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a5530, 0.7);
		this.scene.add(hemi);
		const sun = new THREE.DirectionalLight(0xffffff, 1.2);
		sun.position.set(10, 20, 5);
		this.scene.add(sun);
	}

	async init(): Promise<void> {
		this.physics = await createPhysics();
		const result = buildWorld(this.scene, this.physics);
		this.movingPlatforms = result.moving;
		this.player = new Player(this.scene, this.physics, new THREE.Vector3(0, 2, 0));
		this.input.attach();
		this.onResize();
		window.addEventListener('resize', this.onResize);
		document.addEventListener('visibilitychange', this.onVisibility);
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.lastTime = performance.now();
		this.loop();
	}

	stop(): void {
		this.running = false;
		cancelAnimationFrame(this.rafId);
	}

	dispose(): void {
		this.stop();
		this.input.detach();
		window.removeEventListener('resize', this.onResize);
		document.removeEventListener('visibilitychange', this.onVisibility);
		this.renderer.dispose();
	}

	get inputRef(): Input {
		return this.input;
	}

	respawn(): void {
		this.player?.respawn();
	}

	addYaw(delta: number): void {
		this.cameraYaw += delta;
		if (this.cameraYaw > Math.PI) this.cameraYaw -= 2 * Math.PI;
		if (this.cameraYaw < -Math.PI) this.cameraYaw += 2 * Math.PI;
		this.timeSinceCamInput = 0;
	}

	recenterCam(): void {
		// Snap behind player's facing direction
		if (this.player) this.cameraYaw = this.player.facing;
		else this.cameraYaw = 0;
		this.timeSinceCamInput = 999; // allow auto-tracking immediately after
	}

	getDebugInfo(): DebugInfo & { fps: number; comboReady: boolean; wallKickReady: boolean } {
		return {
			...this.player.debug,
			fps: this.lastFps,
			comboReady: this.player.comboReady,
			wallKickReady: this.player.wallKickReady
		};
	}

	private loop = (): void => {
		if (!this.running) return;
		this.rafId = requestAnimationFrame(this.loop);

		const now = performance.now();
		let dt = (now - this.lastTime) / 1000;
		this.lastTime = now;
		if (dt > 0.25) dt = 0.25;
		this.accumulator += dt;

		// FPS (rolling 60 samples)
		this.fpsSamples.push(dt);
		if (this.fpsSamples.length > 60) this.fpsSamples.shift();
		const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
		this.lastFps = Math.round(1 / avg);

		let steps = 0;
		while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
			this.simTime += FIXED_DT;
			updateMovingPlatforms(this.movingPlatforms, this.physics, this.simTime);
			this.input.setCameraYaw(this.cameraYaw);
			const snap = this.input.sample();
			this.player.step(FIXED_DT, snap, this.physics);
			this.physics.world.step();
			this.accumulator -= FIXED_DT;
			steps += 1;
		}

		this.player.sync();
		this.updateCamera(dt);
		this.renderer.render(this.scene, this.camera);
	};

	private updateCamera(dt: number): void {
		const pos = this.player.position;
		this.cameraTarget.lerp(pos, Math.min(1, dt * 6));

		// Auto-recenter behind player after inactivity + movement
		this.timeSinceCamInput += dt;
		const recenterDelay = config.camRecenterDelayMs / 1000;
		if (this.timeSinceCamInput > recenterDelay && this.player.isMoving) {
			const targetYaw = this.player.facing;
			const diff = normalizeAngle(targetYaw - this.cameraYaw);
			const step = config.camRecenterSpeed * dt;
			if (Math.abs(diff) <= step) this.cameraYaw = targetYaw;
			else this.cameraYaw += Math.sign(diff) * step;
		}

		// Orbit offset around player, rotated by cameraYaw
		const dist = config.camDistance;
		const offsetX = Math.sin(this.cameraYaw) * dist;
		const offsetZ = Math.cos(this.cameraYaw) * dist;
		let camPos = new THREE.Vector3(
			this.cameraTarget.x + offsetX,
			this.cameraTarget.y + config.camHeight,
			this.cameraTarget.z + offsetZ
		);

		// Collision shrink: raycast from target toward camera. Shrink if wall in way.
		const dir = camPos.clone().sub(this.cameraTarget);
		const desiredDist = dir.length();
		if (desiredDist > 0.1) {
			dir.normalize();
			const rapier = this.physics.rapier;
			const ray = new rapier.Ray(
				{ x: this.cameraTarget.x, y: this.cameraTarget.y, z: this.cameraTarget.z },
				{ x: dir.x, y: dir.y, z: dir.z }
			);
			const hit = this.physics.world.castRay(ray, desiredDist, true);
			if (hit) {
				const safeDist = Math.max(hit.timeOfImpact - 0.25, 1.5);
				camPos = this.cameraTarget
					.clone()
					.add(dir.multiplyScalar(safeDist));
			}
		}

		this.camera.position.lerp(camPos, Math.min(1, dt * 8));
		this.camera.lookAt(this.cameraTarget);
	}

	private onResize = (): void => {
		const w = window.innerWidth;
		const h = window.innerHeight;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
	};

	private onVisibility = (): void => {
		if (document.hidden) this.stop();
		else if (!this.running) {
			this.lastTime = performance.now();
			this.start();
		}
	};
}

function normalizeAngle(a: number): number {
	while (a > Math.PI) a -= 2 * Math.PI;
	while (a < -Math.PI) a += 2 * Math.PI;
	return a;
}

