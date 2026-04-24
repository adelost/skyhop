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

	// Camera state. See SKYHOP-CAMERA-SPEC.md for intent.
	// cameraYaw/Pitch/Dist are the *rendered* transform knobs; drag/wheel
	// push them directly and auto-reclaim lerps them toward the behind-facing
	// goal after a short idle. goalFocus/goalPos are solved each frame;
	// cameraTarget and camera.position are the lagged rendered pair.
	private cameraTarget = new THREE.Vector3();
	private cameraYaw = 0;
	private cameraPitch = 0;
	private cameraDist = config.camDistance;
	private timeSinceCamInput = 999;

	private cameraMode: CameraMode = "default_chase";
	private candidateMode: CameraMode = "default_chase";
	private candidateModeT = 0;
	private modeEnterT = 0;
	private goalFocus = new THREE.Vector3();
	private goalPos = new THREE.Vector3();
	// Reserved for commit 2 (manual-offset decay + discrete zoom bands).
	private modeOffsetYaw = 0;
	private panDistance = 0;
	private zoomState: "normal" | "zoomed_out" | "close" = "normal";

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
		this.cameraDist = Math.max(
			config.camZoomMin,
			Math.min(config.camZoomMax, this.cameraDist + delta)
		);
		this.timeSinceCamInput = 0;
	}

	recenterCam(): void {
		if (this.player) this.cameraYaw = this.player.facing;
		else this.cameraYaw = 0;
		this.cameraPitch = 0;
		this.cameraDist = config.camDistance;
		this.modeOffsetYaw = 0;
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
		this.timeSinceCamInput += dt;

		// First-person: early return with direct head-mounted camera. Lab-only
		// feature; the rest of the pipeline is for the mode-driven 3rd-person.
		if (this.firstPerson) {
			this.updateFirstPersonCamera();
			return;
		}

		// FOV stays flat — no speed-breathing in M64 mode.
		if (this.camera.fov !== config.camFovBase) {
			this.camera.fov = config.camFovBase;
			this.camera.updateProjectionMatrix();
		}

		this.selectCameraMode(dt);

		// Y-stabilize during short hops: latch focus-Y to last grounded so the
		// camera doesn't bob on every little jump.
		if (this.player.airborne) this.airborneT += dt;
		else {
			this.airborneT = 0;
			this.stableTargetY = this.player.position.y;
		}
		const stabilizeSec = config.camYStabilizeMs / 1000;
		const effectiveY =
			this.airborneT < stabilizeSec ? this.stableTargetY : this.player.position.y;
		const ledgeLift = this.player.inLedgeHang ? config.camLedgeFramingUp : 0;

		const v = this.player.velocityVec;
		const horizSp = Math.hypot(v.x, v.z);
		const playerMovingFast = horizSp > config.camMovingSpeedThresh;

		// Assertive yaw reclaim: after reclaim delay, cameraYaw approaches
		// baseYawGoal = player.facing regardless of drift magnitude. Slide
		// locks harder than default; idle players get a softer pull so
		// standing still doesn't yank the camera around them.
		const baseYawGoal = this.player.facing;
		const reclaimDelay = config.camReclaimDelayMs / 1000;
		if (this.timeSinceCamInput > reclaimDelay) {
			const baseRate =
				this.cameraMode === "slide_chase"
					? config.camYawFollowSlide
					: config.camYawFollowDefault;
			const rate = playerMovingFast
				? baseRate
				: baseRate * config.camYawFollowStillMult;
			const step = rate * dt;
			const diff = normalizeAngle(baseYawGoal - this.cameraYaw);
			if (Math.abs(diff) <= step) this.cameraYaw = baseYawGoal;
			else this.cameraYaw += Math.sign(diff) * step;
		}

		// Goal distance: state-based. Slide sits a touch further out so downhill
		// reads. User wheel-zoom still wins via cameraDist.
		const goalDist =
			this.cameraMode === "slide_chase"
				? this.cameraDist + config.camSlideDistanceAdd
				: this.cameraDist;

		// Goal focus: player position (with Y stabilize + ledge lift) plus
		// lateral pan along facing when camera is off-axis. Replaces the
		// velocity-forward-lookahead of the old camera — no more "target drags
		// ahead of player in running direction", which felt like sandbox.
		const yawOffset = normalizeAngle(this.player.facing - this.cameraYaw);
		const panAmount = Math.sin(yawOffset) * config.camLateralPanMax * goalDist;
		const facingX = -Math.sin(this.player.facing);
		const facingZ = -Math.cos(this.player.facing);
		this.goalFocus.set(
			this.player.position.x + facingX * panAmount,
			effectiveY + ledgeLift,
			this.player.position.z + facingZ * panAmount,
		);

		// Goal position: orbit around goalFocus using rendered yaw/pitch/dist.
		const pitchRadius = Math.cos(this.cameraPitch) * goalDist;
		const pitchHeight = Math.sin(this.cameraPitch) * goalDist;
		const offsetX = Math.sin(this.cameraYaw) * pitchRadius;
		const offsetZ = Math.cos(this.cameraYaw) * pitchRadius;
		this.goalPos.set(
			this.goalFocus.x + offsetX,
			this.goalFocus.y + config.camHeight - pitchHeight,
			this.goalFocus.z + offsetZ,
		);

		// Collision shrink (commit 2 replaces this with yaw-search-first).
		const toCam = this.goalPos.clone().sub(this.goalFocus);
		const desiredDist = toCam.length();
		if (desiredDist > 0.1) {
			toCam.normalize();
			const rapier = this.physics.rapier;
			const ray = new rapier.Ray(
				{ x: this.goalFocus.x, y: this.goalFocus.y, z: this.goalFocus.z },
				{ x: toCam.x, y: toCam.y, z: toCam.z },
			);
			const hit = this.physics.world.castRay(ray, desiredDist, true);
			if (hit) {
				const safeDist = Math.max(hit.timeOfImpact - 0.25, config.camCollisionMinDist);
				this.goalPos.copy(this.goalFocus).add(toCam.multiplyScalar(safeDist));
			}
		}

		// Asymmetric follow: focus catches up fast (composition), position lags
		// more (physical operator-body feel). H/V split so vertical lag is
		// separate from horizontal.
		this.cameraTarget.x = expFollow(this.cameraTarget.x, this.goalFocus.x, config.camFocusFollowH, dt);
		this.cameraTarget.z = expFollow(this.cameraTarget.z, this.goalFocus.z, config.camFocusFollowH, dt);
		this.cameraTarget.y = expFollow(this.cameraTarget.y, this.goalFocus.y, config.camFocusFollowV, dt);

		let camX = expFollow(this.camera.position.x, this.goalPos.x, config.camPosFollowH, dt);
		let camZ = expFollow(this.camera.position.z, this.goalPos.z, config.camPosFollowH, dt);
		let camY = expFollow(this.camera.position.y, this.goalPos.y, config.camPosFollowV, dt);

		// Ground-pound shake: random offset, decays linearly.
		if (this.shakeT > 0) {
			this.shakeT -= dt;
			const mag = (this.shakeT / config.camShakeDuration) * config.camShakeAmp;
			camX += (Math.random() - 0.5) * mag;
			camY += (Math.random() - 0.5) * mag;
			camZ += (Math.random() - 0.5) * mag;
		}

		this.camera.position.set(camX, camY, camZ);
		this.camera.lookAt(this.cameraTarget);
	}

	private updateFirstPersonCamera(): void {
		const headY = this.player.position.y + 0.3;
		this.camera.position.set(this.player.position.x, headY, this.player.position.z);
		const lookDir = new THREE.Vector3(
			-Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
			Math.sin(this.cameraPitch),
			-Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch),
		);
		this.camera.lookAt(this.camera.position.clone().add(lookDir));
	}

	private selectCameraMode(dt: number): void {
		const p = this.player.debug.state;
		const wanted: CameraMode =
			p === "crouch_slide" || p === "stomach_slide"
				? "slide_chase"
				: "default_chase";
		if (wanted === this.cameraMode) {
			this.candidateMode = wanted;
			this.candidateModeT = 0;
			this.modeEnterT += dt;
			return;
		}
		if (wanted !== this.candidateMode) {
			this.candidateMode = wanted;
			this.candidateModeT = 0;
		}
		this.candidateModeT += dt;
		const thresholdMs =
			wanted === "slide_chase"
				? config.camSlideHysteresisInMs
				: config.camSlideHysteresisOutMs;
		if (this.candidateModeT >= thresholdMs / 1000) {
			this.cameraMode = wanted;
			this.modeEnterT = 0;
		}
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

type CameraMode = "default_chase" | "slide_chase";

function normalizeAngle(a: number): number {
	while (a > Math.PI) a -= 2 * Math.PI;
	while (a < -Math.PI) a += 2 * Math.PI;
	return a;
}

// Frame-rate-independent asymptotic approach. rate is "effective per-second"
// intensity; larger rate = tighter follow. Returns the new value.
function expFollow(current: number, target: number, rate: number, dt: number): number {
	const t = 1 - Math.exp(-rate * dt);
	return current + (target - current) * t;
}
