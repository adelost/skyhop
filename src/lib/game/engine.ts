import * as THREE from 'three';
import { createPhysics, type Physics } from './physics';
import { Input } from './input';
import { buildWorld, updateMovingPlatforms, type MovingPlatform } from './world';
import { Player, type DebugInfo } from './player';
import { config } from './config.svelte';
import { BlobShadow, DustPool } from './effects';

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

	// Camera state
	private cameraTarget = new THREE.Vector3();
	private cameraYaw = 0;
	private cameraPitch = 0;
	private cameraDist = config.camDistance;
	private cameraFov = config.camFovBase;
	private dynDistSmoothed = config.camDistance; // smoothed speed-based dist boost
	private timeSinceCamInput = 999;

	// Y-stabilization during short hops
	private stableTargetY = 0;
	private airborneT = 999; // time since last grounded

	// Ground-pound shake
	private shakeT = 0;

	// First-person mode
	private firstPerson = false;

	// Effects
	private blobShadow!: BlobShadow;
	private dustPool!: DustPool;

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

		this.camera = new THREE.PerspectiveCamera(config.camFovBase, 1, 0.1, 200);

		// Warmer sun + cooler sky for better color separation between lit/shaded sides
		const hemi = new THREE.HemisphereLight(0xaed8ff, 0x445040, 0.55);
		this.scene.add(hemi);
		const sun = new THREE.DirectionalLight(0xfff1d0, 1.35);
		sun.position.set(10, 20, 5);
		this.scene.add(sun);
		// Subtle ambient fill so shadowed sides don't go pitch black
		const ambient = new THREE.AmbientLight(0xffffff, 0.1);
		this.scene.add(ambient);
	}

	async init(): Promise<void> {
		this.physics = await createPhysics();
		const result = buildWorld(this.scene, this.physics);
		this.movingPlatforms = result.moving;
		this.player = new Player(this.scene, this.physics, new THREE.Vector3(0, 2, 0));
		this.stableTargetY = this.player.position.y;
		this.blobShadow = new BlobShadow(this.scene);
		this.dustPool = new DustPool(this.scene);
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
		if (this.player) this.stableTargetY = this.player.position.y;
	}

	addYaw(delta: number): void {
		this.cameraYaw += delta;
		if (this.cameraYaw > Math.PI) this.cameraYaw -= 2 * Math.PI;
		if (this.cameraYaw < -Math.PI) this.cameraYaw += 2 * Math.PI;
		this.timeSinceCamInput = 0;
	}

	addPitch(delta: number): void {
		this.cameraPitch = Math.max(
			config.camPitchMin,
			Math.min(config.camPitchMax, this.cameraPitch + delta)
		);
		this.timeSinceCamInput = 0;
	}

	addZoom(delta: number): void {
		const next = Math.max(
			config.camZoomMin,
			Math.min(config.camZoomMax, this.cameraDist + delta)
		);
		const applied = next - this.cameraDist;
		this.cameraDist = next;
		// Keep smoothed dist in sync so explicit zoom isn't eaten by the lerp.
		this.dynDistSmoothed += applied;
	}

	recenterCam(): void {
		if (this.player) this.cameraYaw = this.player.facing;
		else this.cameraYaw = 0;
		this.cameraPitch = 0;
		this.cameraDist = config.camDistance;
		this.dynDistSmoothed = config.camDistance;
		this.timeSinceCamInput = 999;
	}

	toggleFirstPerson(): void {
		this.firstPerson = !this.firstPerson;
		this.player?.setVisible(!this.firstPerson);
	}

	getDebugInfo(): DebugInfo & {
		fps: number;
		comboReady: boolean;
		wallKickReady: boolean;
		firstPerson: boolean;
	} {
		return {
			...this.player.debug,
			fps: this.lastFps,
			comboReady: this.player.comboReady,
			wallKickReady: this.player.wallKickReady,
			firstPerson: this.firstPerson
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

		this.fpsSamples.push(dt);
		if (this.fpsSamples.length > 60) this.fpsSamples.shift();
		const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
		this.lastFps = Math.round(1 / avg);

		let steps = 0;
		while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
			this.simTime += FIXED_DT;
			updateMovingPlatforms(this.movingPlatforms, this.physics, this.simTime);
			this.player.carryOnPlatform(this.movingPlatforms, this.physics);
			this.player.carryLedgeOnPlatform(this.movingPlatforms);
			this.input.setCameraYaw(this.cameraYaw);
			const snap = this.input.sample();
			this.player.step(FIXED_DT, snap, this.physics);
			this.physics.world.step();
			// Snapshot AFTER physics step so body.translation() reflects the new
			// position. Next fixed step, curr becomes prev → smooth interpolation.
			this.player.snapshotPhysics();
			this.accumulator -= FIXED_DT;
			steps += 1;
		}

		// Classic fixed-timestep interpolation (Glenn Fiedler): alpha ∈ [0,1)
		// tells us how far we are into the NEXT physics step. Renders mesh
		// between prev and curr snapshot so cam-following uses smooth pos.
		const alpha = Math.min(1, this.accumulator / FIXED_DT);
		this.player.sync(alpha);
		// Consume one-shot player events → trigger shake + dust emissions
		if (this.player.consumePoundImpact()) {
			this.shakeT = config.camShakeDuration;
			this.dustPool.emit(this.player.position, 12, 3, 3);
		}
		if (this.player.consumeLandEvent()) {
			this.dustPool.emit(this.player.position, 5, 2, 1.5);
		}
		if (this.player.consumeSkidEvent()) {
			this.dustPool.emit(this.player.position, 4, 1, 2.2);
		}
		this.blobShadow.update(this.physics, this.player.position, this.player.colliderRef);
		this.dustPool.update(dt);
		this.updateCamera(dt);
		this.renderer.render(this.scene, this.camera);
	};

	private updateCamera(dt: number): void {
		// Y-stabilize: during short hops, keep look-at Y latched to last grounded Y
		// so camera doesn't bounce up/down with each little jump.
		if (this.player.airborne) this.airborneT += dt;
		else {
			this.airborneT = 0;
			this.stableTargetY = this.player.position.y;
		}
		const stabilizeSec = config.camYStabilizeMs / 1000;
		const effectiveY =
			this.airborneT < stabilizeSec ? this.stableTargetY : this.player.position.y;

		// Look-ahead: bias target in velocity direction so spelaren ser framåt
		const v = this.player.velocityVec;
		const horizSp = Math.hypot(v.x, v.z);
		const aheadFactor = Math.min(1, horizSp / config.camLookAheadSpeedRef);
		const aheadX = horizSp > 0.1 ? (v.x / horizSp) * config.camLookAheadDist * aheadFactor : 0;
		const aheadZ = horizSp > 0.1 ? (v.z / horizSp) * config.camLookAheadDist * aheadFactor : 0;

		// Ledge-hang: lift framing so player sees top of wall
		const ledgeLift = this.player.inLedgeHang ? config.camLedgeFramingUp : 0;

		const desiredTarget = new THREE.Vector3(
			this.player.position.x + aheadX,
			effectiveY + ledgeLift,
			this.player.position.z + aheadZ
		);
		this.cameraTarget.lerp(desiredTarget, Math.min(1, dt * config.camLerpRate));

		// Auto-recenter yaw behind player direction: only if
		//   (a) player moving fast enough,
		//   (b) user hasn't touched cam recently,
		//   (c) cam actually drifted far from ideal.
		this.timeSinceCamInput += dt;
		const recenterDelay = config.camRecenterDelayMs / 1000;
		const playerMovingFast = horizSp > config.camRecenterMinSpeed;
		if (this.timeSinceCamInput > recenterDelay && playerMovingFast) {
			const targetYaw = this.player.facing;
			const diff = normalizeAngle(targetYaw - this.cameraYaw);
			if (Math.abs(diff) > config.camRecenterMinYawDiff) {
				const step = config.camRecenterSpeed * dt;
				if (Math.abs(diff) <= step) this.cameraYaw = targetYaw;
				else this.cameraYaw += Math.sign(diff) * step;
			}
		}

		// Speed-adaptive zoom + FOV. Both smoothed at same rate so accel + decel
		// feel symmetric. Current values are subtle (Odyssey-ish, not arcade).
		const speedFrac = Math.min(1, horizSp / config.camLookAheadSpeedRef);
		const targetDist = this.cameraDist + config.camDistSpeedBoost * speedFrac;
		const targetFov = config.camFovBase + config.camFovSpeedBoost * speedFrac;
		const boostLerp = Math.min(1, dt * config.camSpeedBoostLerp);
		this.dynDistSmoothed += (targetDist - this.dynDistSmoothed) * boostLerp;
		this.cameraFov += (targetFov - this.cameraFov) * boostLerp;
		this.camera.fov = this.cameraFov;
		this.camera.updateProjectionMatrix();
		const dynDist = this.dynDistSmoothed;

		// Position camera
		let camPos: THREE.Vector3;
		if (this.firstPerson) {
			// First-person: cam at player head, look in yaw+pitch direction
			const headY = this.player.position.y + 0.3;
			camPos = new THREE.Vector3(this.player.position.x, headY, this.player.position.z);
			this.camera.position.copy(camPos);
			const lookDir = new THREE.Vector3(
				-Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
				Math.sin(this.cameraPitch),
				-Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch)
			);
			this.camera.lookAt(camPos.clone().add(lookDir));
			return;
		}

		// Third-person orbit
		const pitchRadius = Math.cos(this.cameraPitch) * dynDist;
		const pitchHeight = Math.sin(this.cameraPitch) * dynDist;
		const offsetX = Math.sin(this.cameraYaw) * pitchRadius;
		const offsetZ = Math.cos(this.cameraYaw) * pitchRadius;
		camPos = new THREE.Vector3(
			this.cameraTarget.x + offsetX,
			this.cameraTarget.y + config.camHeight - pitchHeight,
			this.cameraTarget.z + offsetZ
		);

		// Collision shrink
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
				// Floor at camCollisionMinDist so cam never collapses into player ("huge
				// capsule fills screen"). Keep margin 0.25 m off the hit geometry.
				const safeDist = Math.max(hit.timeOfImpact - 0.25, config.camCollisionMinDist);
				camPos = this.cameraTarget.clone().add(dir.multiplyScalar(safeDist));
			}
		}

		// Ground-pound shake: random offset, decays linearly
		if (this.shakeT > 0) {
			this.shakeT -= dt;
			const mag = (this.shakeT / config.camShakeDuration) * config.camShakeAmp;
			camPos.x += (Math.random() - 0.5) * mag;
			camPos.y += (Math.random() - 0.5) * mag;
			camPos.z += (Math.random() - 0.5) * mag;
		}

		this.camera.position.lerp(camPos, Math.min(1, dt * config.camLerpRate));
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
