import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { Physics } from "./physics";
import type { InputState } from "./input";
import type { MovingPlatform } from "./world";
import { config } from "./config.svelte";
import {
	queryGroundSurface,
	queryWallContact,
	tryLedgeGrab,
	verifyLedgeAt,
	verifyClearanceAbove,
	type WallNormal,
} from "./player-queries";
import { computePose, computeLimbs } from "./player-visuals";
import { buildPlayerMeshes, type Limbs } from "./player-mesh";
import { computeJump, computeWallKick } from "./player-jumps";
import { RADIUS, HEIGHT } from "./player-constants";

export type PlayerState =
	| "grounded"
	| "airborne"
	| "wall_slide"
	| "ground_pound_start"
	| "ground_pound"
	| "dive"
	| "long_jump"
	| "backflip"
	| "side_flip"
	| "slope_slide"
	| "crouch_slide"
	| "stomach_slide"
	| "skid"
	| "ledge_hang"
	| "ledge_climb_fast"
	| "ledge_climb_slow"
	| "ledge_climb_down"
	// M64 punch combo (act_punching / act_move_punching / kick state).
	// Re-tapping action inside each state's recovery window chains forward.
	| "punch_1"
	| "punch_2"
	| "kick"
	// M64 act_crawling: Z held + analog tilt at low speed.
	| "crawl"
	// M64 sweep kick (mario_update_punch_sequence case 9): Z + B → 360° leg sweep
	// from a hands-on-ground breakdance pose, frozen in place.
	| "sweep_kick"
	// M64 act_jump_kick: B in air at low forward speed → leg-out air kick.
	| "aerial_kick";

// Latched at takeoff/trigger, cleared on touchdown (snapshotted into
// landingStyle). Drives per-move landing recovery so single/double/triple/
// dive/pound all read differently without extra state cases.
export type MoveVariant =
	| "single"
	| "double"
	| "triple"
	| "backflip"
	| "side_flip"
	| "long_jump"
	| "dive"
	| "wall_kick"
	| "ground_pound"
	| "punch"
	| "sweep_kick"
	| "aerial_kick";

export type DebugInfo = {
	state: PlayerState;
	vx: number;
	vy: number;
	vz: number;
	speed: number;
	grounded: boolean;
	slopeAngleDeg: number;
	surface: string;
};

export class Player {
	readonly mesh: THREE.Group; // outer — physics-aligned (position only)
	private visualGroup: THREE.Group; // inner — rotation + scale + crouch offset
	private limbs: Limbs;
	private body: RAPIER.RigidBody;
	private controller: RAPIER.KinematicCharacterController;
	private collider: RAPIER.Collider;

	private velocity = new THREE.Vector3();
	private grounded = false;
	private timeSinceGrounded = 999;
	private jumpBufferT = 999;
	private timeSinceLanding = 999;
	private jumpChain = 0;
	private chainOnLanding = 0;
	private state: PlayerState = "airborne";
	private surface = "air";
	private slopeNormal = new THREE.Vector3(0, 1, 0);
	private slopeAngleDeg = 0;

	private facingYaw = 0; // radians; 0 = facing world -Z
	private targetYaw = 0;
	private skidT = 999;

	private wallNormal: WallNormal | null = null;
	private timeSinceWall = 999;
	private lastWallKickNormal: WallNormal | null = null;
	private timeSinceWallKick = 999;

	// Ledge climb animation state. climbT = -1 = not climbing.
	private climbT = -1;
	private climbStart = new THREE.Vector3();
	private climbEnd = new THREE.Vector3();
	private shimmyDir = 0; // -1, 0, or +1
	private climbIntentT = 0;
	// M64-style climb variants. Fast = A-press, Slow = forward-stick after
	// minimum hang, Down = back-stick + crouch (descends to airborne below
	// the ledge face). Drives per-variant duration and end-state.
	private climbVariant: "fast" | "slow" | "down" = "slow";

	private ledgePos: { x: number; y: number; z: number } | null = null;
	// Actual wall normal at chest hit — captured during grab, used for shimmy.
	// Distinct from wallNormal (which comes from the coarse 4-cardinal query).
	private ledgeNormal: WallNormal | null = null;
	// RigidBody handle of the grabbed surface. If it matches a moving platform,
	// we carry ledgePos by platform.delta each frame so shimmy still verifies
	// against the actual wall when the platform bounces.
	private ledgeBodyHandle: number | null = null;
	private ledgeGrabCooldown = 0;

	// One-shot event flags consumed by engine for effects (shake, dust).
	private poundImpactPending = false;
	private landImpactPending = false;
	private skidStartPending = false;
	// Punch combo timer (seconds inside current punch state). Combo input is
	// accepted only after the active phase ends (so the player has to commit
	// to a hit before chaining the next one), and rejected after recovery
	// closes (so the swing returns to idle cleanly).
	private punchT = 0;
	// Sweep kick timer (seconds inside sweep_kick state). Drives auto-exit
	// and the 360° yaw spin curve.
	private sweepT = 0;
	// Aerial kick timer (seconds inside aerial_kick state). Hard cap so the
	// kick pose doesn't persist across long falls — after cap, state returns
	// to airborne so wall_kick / ledge_grab can resume.
	private aerialKickT = 0;
	// Landing-squash decaying timer (seconds). Multiplies visual scale.y briefly.
	private landingSquashT = 0;
	private groundPoundStartT = 0;
	// Seconds since the current state was entered. Reset each time state
	// changes (detected in updateVisuals). Used for phase-based rotation
	// curves (side_flip roll, triple/backflip somersault).
	private stateTime = 0;
	private prevVisState: PlayerState = "airborne";

	// Latched at takeoff/trigger, snapshotted into landingStyle on touchdown
	// so recovery pose + duration can be per-move without extra state cases.
	private moveVariant: MoveVariant | null = null;
	private landingStyle: MoveVariant | null = null;
	private landingStyleT = 0;

	// Visual state
	private pitchAngle = 0; // accumulated flip rotation (radians)
	private yawSpin = 0; // extra yaw for side-flip pirouette
	private crouching = false;
	private accumTime = 0; // ticks up each step(); phase source for limb swing

	// Render interpolation. Physics runs at fixed 60Hz but render can run at
	// 120/144/240Hz. Snapshot body.translation() after each fixed step into
	// curr (rotating prev←curr first), then sync() lerps mesh using
	// alpha = accumulator/FIXED_DT from engine. Eliminates run judder.
	private prevBodyPos = new THREE.Vector3();
	private currBodyPos = new THREE.Vector3();

	private startPos: THREE.Vector3;

	constructor(scene: THREE.Scene, physics: Physics, spawn: THREE.Vector3) {
		this.startPos = spawn.clone();

		const meshes = buildPlayerMeshes();
		this.mesh = meshes.outer;
		this.visualGroup = meshes.inner;
		this.limbs = meshes.limbs;
		this.mesh.position.copy(spawn);
		this.prevBodyPos.copy(spawn);
		this.currBodyPos.copy(spawn);
		scene.add(this.mesh);

		const { world, rapier } = physics;
		const bodyDesc =
			rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
				spawn.x,
				spawn.y,
				spawn.z,
			);
		this.body = world.createRigidBody(bodyDesc);
		const colDesc = rapier.ColliderDesc.capsule(HEIGHT / 2, RADIUS);
		this.collider = world.createCollider(colDesc, this.body);

		this.controller = world.createCharacterController(0.01);
		this.controller.setApplyImpulsesToDynamicBodies(true);
		this.controller.enableAutostep(0.3, 0.2, true);
		this.controller.enableSnapToGround(0.3);
		this.controller.setMaxSlopeClimbAngle((60 * Math.PI) / 180);
	}

	/**
	 * Inherit this-frame translation of whatever moving platform the player is
	 * standing on. Called from engine loop AFTER platforms update and BEFORE
	 * player.step, so player's movement starts from the carried position.
	 */
	carryOnPlatform(platforms: MovingPlatform[], physics: Physics): void {
		if (!this.grounded || platforms.length === 0) return;
		const { world, rapier } = physics;
		const origin = this.body.translation();
		const ray = new rapier.Ray(
			{ x: origin.x, y: origin.y + 0.1, z: origin.z },
			{ x: 0, y: -1, z: 0 },
		);
		const hit = world.castRay(
			ray,
			HEIGHT + 0.5,
			true,
			undefined,
			undefined,
			this.collider,
		);
		if (!hit) return;
		const parentBody = hit.collider.parent();
		if (!parentBody) return;
		for (const p of platforms) {
			if (parentBody.handle === p.bodyHandle) {
				this.body.setTranslation(
					{
						x: origin.x + p.delta.x,
						y: origin.y + p.delta.y,
						z: origin.z + p.delta.z,
					},
					true,
				);
				return;
			}
		}
	}

	/**
	 * Moving-platform carry for a grabbed ledge. If the player is hanging on a
	 * kinematic moving platform, shift ledgePos by the platform's per-frame
	 * delta so shimmy verifies against the actual wall (otherwise the platform
	 * bounces out from under the pinned ledgePos and raycasts miss). Called
	 * from engine each fixed step, before player.step().
	 */
	carryLedgeOnPlatform(platforms: MovingPlatform[]): void {
		if (
			this.state !== "ledge_hang" ||
			!this.ledgePos ||
			this.ledgeBodyHandle === null
		)
			return;
		for (const p of platforms) {
			if (p.bodyHandle === this.ledgeBodyHandle) {
				this.ledgePos = {
					x: this.ledgePos.x + p.delta.x,
					y: this.ledgePos.y + p.delta.y,
					z: this.ledgePos.z + p.delta.z,
				};
				return;
			}
		}
	}

	respawn(): void {
		this.body.setTranslation(
			{ x: this.startPos.x, y: this.startPos.y, z: this.startPos.z },
			true,
		);
		this.velocity.set(0, 0, 0);
		// Snap interpolation anchors so mesh doesn't lerp across teleport.
		this.prevBodyPos.copy(this.startPos);
		this.currBodyPos.copy(this.startPos);
		// Full transient reset so first frame doesn't inherit ghost coyote/combo/wall-kick.
		this.grounded = false;
		this.timeSinceGrounded = 999;
		this.timeSinceLanding = 999;
		this.jumpBufferT = 999;
		this.jumpChain = 0;
		this.chainOnLanding = 0;
		this.wallNormal = null;
		this.timeSinceWall = 999;
		this.lastWallKickNormal = null;
		this.timeSinceWallKick = 999;
		this.ledgePos = null;
		this.ledgeNormal = null;
		this.ledgeBodyHandle = null;
		this.ledgeGrabCooldown = 0;
		this.climbT = -1;
		this.shimmyDir = 0;
		this.climbIntentT = 0;
		this.skidT = 999;
		this.pitchAngle = 0;
		this.yawSpin = 0;
		this.crouching = false;
		this.poundImpactPending = false;
		this.landImpactPending = false;
		this.skidStartPending = false;
		this.landingSquashT = 0;
		this.groundPoundStartT = 0;
		this.punchT = 0;
		this.sweepT = 0;
		this.aerialKickT = 0;
		this.state = "airborne";
	}

	step(dt: number, input: InputState, physics: Physics): void {
		// Track crouch for visual purposes (outlives input frame)
		this.crouching = input.crouchHeld;
		this.accumTime += dt;
		if (this.landingSquashT > 0)
			this.landingSquashT = Math.max(0, this.landingSquashT - dt);
		if (this.landingStyleT > 0) {
			this.landingStyleT = Math.max(0, this.landingStyleT - dt);
			if (this.landingStyleT === 0) this.landingStyle = null;
		}

		// Query slope/surface FIRST so this frame's movement knows about it.
		this.surface = this.grounded
			? queryGroundSurface(physics, this.collider, this.body, this.slopeNormal)
			: (this.slopeNormal.set(0, 1, 0), "air");
		const ny = Math.max(-1, Math.min(1, this.slopeNormal.y));
		this.slopeAngleDeg = Math.acos(ny) * (180 / Math.PI);

		// Handle ledge-hang as a separate mini state machine. Climb variant
		// states also route here so the animation block can complete before
		// transitioning out.
		if (
			this.state === "ledge_hang" ||
			this.state === "ledge_climb_fast" ||
			this.state === "ledge_climb_slow" ||
			this.state === "ledge_climb_down"
		) {
			this.handleLedgeHang(input, physics, dt);
			return;
		}
		this.ledgeGrabCooldown = Math.max(0, this.ledgeGrabCooldown - dt);

		// Camera-relative input → world.
		const cy = Math.cos(input.cameraYaw);
		const sy = Math.sin(input.cameraYaw);
		const mx = input.moveX * cy + input.moveZ * sy;
		const mz = -input.moveX * sy + input.moveZ * cy;

		const hasInput = Math.abs(mx) > 0.01 || Math.abs(mz) > 0.01;
		const onIce = this.surface === "ice";

		// Detect state: is slope steep enough to force a slide?
		const slopeTooSteep =
			this.grounded && this.slopeAngleDeg >= config.slopeSlideAngleDeg;

		// Crouch+run on a non-flat slope → voluntary crouch-slide.
		const wantsCrouchSlide =
			this.grounded &&
			input.crouchHeld &&
			this.slopeAngleDeg >= 5 &&
			!slopeTooSteep;

		// Z-tap while running → belly slide (flat or any surface).
		const wantsDashSlide =
			this.grounded &&
			input.crouchPressed &&
			Math.hypot(this.velocity.x, this.velocity.z) > 4 &&
			this.state !== "crouch_slide";

		// Crouch + analog tilt at low ground speed → crawl. Loses to crouch_slide
		// at higher speeds (M64 same: butt-slide overrides crawl when running).
		const wantsCrawl =
			this.grounded &&
			input.crouchHeld &&
			hasInput &&
			Math.hypot(this.velocity.x, this.velocity.z) < 4 &&
			!slopeTooSteep &&
			!wantsCrouchSlide &&
			!wantsDashSlide &&
			this.state !== "stomach_slide" &&
			this.state !== "skid" &&
			this.state !== "punch_1" &&
			this.state !== "punch_2" &&
			this.state !== "kick";

		// Update state based on grounded context.
		if (this.grounded) {
			if (slopeTooSteep) {
				this.state = "slope_slide";
			} else if (
				wantsCrouchSlide ||
				wantsDashSlide ||
				this.state === "crouch_slide"
			) {
				const sliding =
					input.crouchHeld &&
					Math.hypot(this.velocity.x, this.velocity.z) > 0.5;
				this.state = sliding ? "crouch_slide" : "grounded";
			} else if (this.state === "stomach_slide") {
				// Dive-landing slide: stays until lateral drops below threshold.
				// No crouch-hold requirement — it's a recovery, not voluntary.
				const sliding = Math.hypot(this.velocity.x, this.velocity.z) > 1.5;
				if (!sliding) this.state = "grounded";
			} else if (this.state === "skid") {
				this.skidT += dt;
				if (this.skidT >= config.skidDurationMs / 1000) this.state = "grounded";
			} else if (this.state === "crawl" || wantsCrawl) {
				// Stays in crawl as long as Z + analog held; otherwise back to idle.
				this.state =
					input.crouchHeld && hasInput ? "crawl" : "grounded";
			} else {
				this.state = "grounded";
			}
		}

		// speedTarget depends on final state — crawl uses its own slow target.
		const speedTarget =
			this.state === "crawl" ? config.crawlSpeed : config.moveSpeed;
		const targetX = mx * speedTarget;
		const targetZ = mz * speedTarget;

		// Horizontal accel/decel. Locked states keep their momentum.
		const momentumLocked =
			(!this.grounded &&
				(this.state === "long_jump" ||
					this.state === "backflip" ||
					this.state === "side_flip" ||
					this.state === "dive" ||
					this.state === "ground_pound_start" ||
					this.state === "ground_pound" ||
					this.state === "aerial_kick")) ||
			this.state === "slope_slide" ||
			this.state === "crouch_slide" ||
			this.state === "stomach_slide" ||
			this.state === "skid" ||
			// Punch states freeze player input — XZ decay handled in punch handler.
			this.state === "punch_1" ||
			this.state === "punch_2" ||
			this.state === "kick" ||
			// Sweep kick: locked in place, only yaw spins.
			this.state === "sweep_kick";

		let groundRate: number;
		if (this.state === "crawl") {
			groundRate = config.crawlAccel;
		} else if (hasInput) {
			groundRate = onIce ? config.accel * config.iceFriction : config.accel;
		} else {
			groundRate = onIce ? config.decel * config.iceFriction : config.decel;
		}
		const accelRate = this.grounded
			? groundRate
			: config.accel * config.airControl;

		if (!momentumLocked) {
			if (hasInput) {
				// Accelerate toward camera-relative target. Component-wise approach is
				// fine here because target has a direction — velocity smoothly aligns.
				this.velocity.x = approach(this.velocity.x, targetX, accelRate * dt);
				this.velocity.z = approach(this.velocity.z, targetZ, accelRate * dt);
			} else {
				// Idle decel: preserve direction, shrink magnitude only. Component-wise
				// approach would rotate diagonal velocity toward the axes during decel
				// → facing drifts → character visibly turns while stopping. M64 keeps
				// direction locked through decel so Mario slides forward then stops.
				const sp = Math.hypot(this.velocity.x, this.velocity.z);
				if (sp > 0.001) {
					const newSp = Math.max(0, sp - accelRate * dt);
					const k = newSp / sp;
					this.velocity.x *= k;
					this.velocity.z *= k;
				} else {
					this.velocity.x = 0;
					this.velocity.z = 0;
				}
			}

			// Skid-turn detection: grounded + fast + input reverses direction.
			// M64 uses this window to allow A-press = side flip. Visual: lean back + freeze.
			const horizSp = Math.hypot(this.velocity.x, this.velocity.z);
			if (
				this.grounded &&
				this.state === "grounded" &&
				horizSp > 4 &&
				hasInput
			) {
				const inputYaw = Math.atan2(-mx, -mz);
				const deltaYaw = angleDiff(inputYaw, this.facingYaw);
				if (Math.abs(deltaYaw) > (config.skidReverseDeg * Math.PI) / 180) {
					this.state = "skid";
					this.skidT = 0;
					this.skidStartPending = true;
					this.targetYaw = inputYaw;
					// Preserve some momentum — player keeps skidding a bit before turning
					this.velocity.x *= config.skidVelocityCut;
					this.velocity.z *= config.skidVelocityCut;
				}
			}
		}

		// Crouch-slide: gentle friction decay + downhill boost if on slope.
		if (this.state === "crouch_slide") {
			this.velocity.x = approach(this.velocity.x, 0, 5 * dt);
			this.velocity.z = approach(this.velocity.z, 0, 5 * dt);
			if (this.slopeAngleDeg >= 5) {
				const g = new THREE.Vector3(0, config.gravity, 0);
				const n = this.slopeNormal.clone().normalize();
				const gAlong = g.clone().sub(n.clone().multiplyScalar(g.dot(n)));
				this.velocity.x += gAlong.x * dt * 0.7;
				this.velocity.z += gAlong.z * dt * 0.7;
			}
		}
		// Stomach-slide: belly-drag after dive landing. Higher friction than the
		// butt slide since the whole body is on the ground.
		if (this.state === "stomach_slide") {
			this.velocity.x = approach(this.velocity.x, 0, 8 * dt);
			this.velocity.z = approach(this.velocity.z, 0, 8 * dt);
		}
		// Punch combo: tick timer, decay XZ slowly, auto-exit at end of state.
		// Phase encoded in state name (punch_1 → punch_2 → kick).
		if (
			this.state === "punch_1" ||
			this.state === "punch_2" ||
			this.state === "kick"
		) {
			this.punchT += dt;
			this.velocity.x = approach(this.velocity.x, 0, config.punchDecel * dt);
			this.velocity.z = approach(this.velocity.z, 0, config.punchDecel * dt);
			const total =
				this.state === "punch_1"
					? (config.punch1ActiveMs + config.punch1RecoveryMs) / 1000
					: this.state === "punch_2"
						? (config.punch2ActiveMs + config.punch2RecoveryMs) / 1000
						: (config.kickActiveMs + config.kickRecoveryMs) / 1000;
			if (this.punchT >= total) {
				// Recovery window over — return to grounded with short land-style.
				this.state = "grounded";
				this.punchT = 0;
				this.landingStyle = "punch";
				this.landingStyleT = config.landPunchMs / 1000;
				this.moveVariant = null;
			}
		}
		// Sweep kick tick: frozen XZ, ticks timer, auto-exits at end. Yaw spin
		// is driven from sweepT in computePose.
		if (this.state === "sweep_kick") {
			this.sweepT += dt;
			this.velocity.x = 0;
			this.velocity.z = 0;
			const total =
				(config.sweepStartupMs +
					config.sweepActiveMs +
					config.sweepRecoveryMs) /
				1000;
			if (this.sweepT >= total) {
				this.state = "grounded";
				this.sweepT = 0;
				this.landingStyle = "sweep_kick";
				this.landingStyleT = config.landSweepMs / 1000;
				this.moveVariant = null;
			}
		}
		// Aerial kick tick: gravity drives the body normally, the kick is just
		// a state lock with a duration cap. Landing handler clears state and
		// snapshots landingStyle separately.
		if (this.state === "aerial_kick") {
			this.aerialKickT += dt;
			if (this.aerialKickT >= config.aerialKickDurationMs / 1000) {
				this.state = "airborne";
				this.aerialKickT = 0;
				// Keep moveVariant so landingStyle still latches as aerial_kick.
			}
		} else {
			this.aerialKickT = 0;
		}

		this.timeSinceGrounded += dt;
		if (this.grounded) {
			this.timeSinceGrounded = 0;
			this.timeSinceLanding += dt;
		}

		// Track facing from velocity (desired yaw).
		const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
		if (this.shouldTrackFacingFromVelocity(horizSpeed)) {
			this.targetYaw = Math.atan2(-this.velocity.x, -this.velocity.z);
		}

		// Jump buffer
		if (input.jumpPressed) this.jumpBufferT = 0;
		else this.jumpBufferT += dt;
		this.timeSinceWallKick += dt;

		const coyoteSec = config.coyoteMs / 1000;
		const bufferSec = config.bufferMs / 1000;
		const wallStickSec = config.wallStickMs / 1000;
		const canGroundJump =
			this.timeSinceGrounded <= coyoteSec && this.jumpBufferT <= bufferSec;

		// Same-wall lockout: after kicking off a wall, can't kick the same face
		// within sameWallLockoutMs. M64 enforces alternation so chains aren't abused.
		const sameWallLockout =
			!!this.lastWallKickNormal &&
			!!this.wallNormal &&
			this.timeSinceWallKick < config.sameWallLockoutMs / 1000 &&
			this.lastWallKickNormal.x * this.wallNormal.x +
				this.lastWallKickNormal.z * this.wallNormal.z >
				0.9;
		const canWallKick =
			!this.grounded &&
			!!this.wallNormal &&
			this.timeSinceWall <= wallStickSec &&
			this.jumpBufferT <= bufferSec &&
			!sameWallLockout;

		if (canWallKick) {
			this.executeWallKick();
			haptic(20);
		} else if (canGroundJump) {
			this.executeJump(input, horizSpeed, mx, mz);
			haptic(12);
		}

		// Grounded action button = M64 B button. Routing matches M64:
		//   crouchHeld          → sweep kick / breakdance (Phase 3, not yet wired)
		//   speed ≥ threshold   → dive (run + B)
		//   otherwise           → punch combo (chain-aware)
		if (input.actionPressed && this.grounded) {
			const inPunchState =
				this.state === "punch_1" ||
				this.state === "punch_2" ||
				this.state === "kick";
			if (input.crouchHeld) {
				// Z + action grounded → sweep kick. Allowed from idle crouch,
				// crawl, and even mid-punch (cancel into sweep).
				if (this.state !== "sweep_kick") {
					this.executeSweepKick();
					haptic(15);
				}
			} else if (horizSpeed >= config.diveSpeedThreshold && !inPunchState) {
				// Ground dive: run + B. Mirrors aerial dive impulse but launches us
				// off the ground so existing dive→stomach_slide landing path runs.
				this.executeDive(horizSpeed, mx, mz, true);
				haptic(15);
			} else {
				// Punch combo. Chain only after the active phase closes — forces
				// the player to commit one swing before queuing the next.
				if (this.state === "punch_1") {
					if (this.punchT >= config.punch1ActiveMs / 1000)
						this.executePunch(2);
				} else if (this.state === "punch_2") {
					if (this.punchT >= config.punch2ActiveMs / 1000)
						this.executePunch(3);
				} else if (this.state !== "kick") {
					this.executePunch(1);
				}
				haptic(8);
			}
		}

		// Aerial actions (ground pound / dive / aerial kick). M64 mapping:
		//   Z (crouch press)                 → ground pound
		//   B (action) + speed ≥ threshold   → dive
		//   B (action) + speed < threshold   → aerial kick
		if (
			!this.grounded &&
			this.state !== "ground_pound_start" &&
			this.state !== "ground_pound" &&
			this.state !== "dive" &&
			this.state !== "aerial_kick"
		) {
			const triggerGP = input.crouchPressed;
			const triggerDive =
				input.actionPressed && horizSpeed >= config.diveSpeedThreshold;
			const triggerAerialKick =
				input.actionPressed && horizSpeed < config.diveSpeedThreshold;
			if (triggerGP) {
				this.velocity.x *= 0.18;
				this.velocity.z *= 0.18;
				this.velocity.y = Math.max(
					this.velocity.y,
					config.groundPoundStartVelY,
				);
				this.state = "ground_pound_start";
				this.groundPoundStartT = 0;
				this.jumpChain = 0;
				this.moveVariant = "ground_pound";
				this.setFacing(this.facingYaw);
				haptic(15);
			} else if (triggerDive) {
				this.executeDive(horizSpeed, mx, mz, false);
				haptic(15);
			} else if (triggerAerialKick) {
				this.executeAerialKick();
				haptic(12);
			}
		}

		if (this.state === "ground_pound_start") {
			const startupSec = Math.max(0.001, config.groundPoundStartMs / 1000);
			this.groundPoundStartT += dt;
			// M64 freezes Mario in XZ completely during the spin — no decel curve,
			// just locked. Vertical gets a decaying upward pop (M64 adds direct
			// position offsets per frame totaling ~1.1m; we mimic via vy linearly
			// decaying from startVelY to 0 so integration gives the same curve).
			this.velocity.x = 0;
			this.velocity.z = 0;
			const frac = Math.min(1, this.groundPoundStartT / startupSec);
			this.velocity.y = config.groundPoundStartVelY * (1 - frac);
			if (this.groundPoundStartT >= startupSec) {
				this.state = "ground_pound";
				this.groundPoundStartT = 0;
				this.velocity.y = config.groundPoundVel;
			}
		}

		// Variable jump cut (M64 mario_step.c:529): only kicks in while ascending
		// fast (vy > jumpCutMinVel ≈ 6 m/s = M64's 20 u/f threshold). Below that
		// the boost is already gone and an extra cut would just deaden the arc.
		const cuttable =
			this.state === "airborne" &&
			(this.jumpChain === 1 || this.jumpChain === 2 || this.jumpChain === 3);
		const cutActive =
			cuttable && !input.jumpHeld && this.velocity.y > config.jumpCutMinVel;
		let gravMult = cutActive ? config.jumpAscentCutMult : 1;

		if (this.state === "ground_pound_start")
			gravMult *= config.groundPoundStartGravityMult;

		// Long jump uses half gravity so the arc carries (M64 mario_step.c:543).
		if (this.state === "long_jump") gravMult *= config.longJumpGravityMult;

		// Wall-slide cling: reduced gravity while hugging wall
		if (this.state === "wall_slide") gravMult *= config.wallSlideGravityMult;

		this.velocity.y += config.gravity * gravMult * dt;
		if (this.velocity.y < -config.terminalVel)
			this.velocity.y = -config.terminalVel;

		const desired = {
			x: this.velocity.x * dt,
			y: this.velocity.y * dt,
			z: this.velocity.z * dt,
		};
		this.controller.computeColliderMovement(this.collider, desired);

		const wasGrounded = this.grounded;
		this.grounded = this.controller.computedGrounded();
		if (this.grounded) {
			if (!wasGrounded) {
				const landVy = this.velocity.y;
				const fellFast = landVy < -15;
				const poundLikeImpact =
					this.state === "ground_pound" || this.state === "ground_pound_start";
				// Trigger land-squash for any non-trivial fall; scale magnitude with vy.
				if (poundLikeImpact) {
					this.landingSquashT = Math.max(
						this.landingSquashT,
						config.groundPoundImpactSquashMs / 1000,
					);
				} else if (landVy < -5) {
					this.landingSquashT = Math.min(0.18, 0.08 + Math.abs(landVy) * 0.008);
					this.landImpactPending = true;
				}
				if (poundLikeImpact) {
					this.velocity.x = 0;
					this.velocity.z = 0;
					this.velocity.y = config.groundPoundBounce;
					this.poundImpactPending = true;
					this.groundPoundStartT = 0;
					haptic(60);
				} else if (this.velocity.y < 0) {
					this.velocity.y = 0;
				}
				if (this.state === "dive") {
					this.velocity.x *= 0.3;
					this.velocity.z *= 0.3;
				}
				if (fellFast && !poundLikeImpact) haptic(25);
				this.timeSinceLanding = 0;
				this.chainOnLanding = this.jumpChain;
				this.jumpChain = 0;
				// Remember whether this was a dive-landing before we overwrite
				// state — routes into stomach_slide for the drag recovery.
				const wasDive = this.state === "dive";
				// Snapshot moveVariant into landingStyle so recovery pose has the
				// right duration and per-style look. Cleared when the window
				// decays to 0 in step().
				if (this.moveVariant) {
					this.landingStyle = this.moveVariant;
					this.landingStyleT = landingDurationFor(this.moveVariant);
					this.moveVariant = null;
				}
				// Dive with residual lateral velocity becomes a belly drag.
				// Otherwise just grounded; next tick re-evaluates normally.
				if (
					wasDive &&
					Math.hypot(this.velocity.x, this.velocity.z) > 1.5
				) {
					this.state = "stomach_slide";
				} else {
					this.state = "grounded";
				}
			} else if (this.velocity.y < 0) {
				this.velocity.y = 0;
			}
		} else if (wasGrounded) {
			this.state = "airborne";
		}

		// Apply slope physics for slope_slide state (after grounded updates)
		this.applySlopePhysics(dt);

		// Wall detection (capture contact only — state change happens after ledge check).
		this.timeSinceWall += dt;
		const wallHit = this.grounded
			? null
			: queryWallContact(physics, this.collider, this.body);
		if (wallHit) {
			this.wallNormal = wallHit;
			this.timeSinceWall = 0;
		}

		// Ledge grab FIRST so wall_slide doesn't lock us out. Require user intent
		// (stick pressed toward wall) OR decisive velocity-into-wall, so drifting
		// past a wall doesn't magnet-snap.
		const horizSp = Math.hypot(this.velocity.x, this.velocity.z);
		const ledgeEligibleState =
			this.state === "airborne" || this.state === "wall_slide";
		let hasIntent = false;
		if (this.wallNormal) {
			const inputMag = Math.hypot(mx, mz);
			const inputIntoWall =
				inputMag > 0.3
					? (mx * -this.wallNormal.x + mz * -this.wallNormal.z) / inputMag
					: 0;
			const velIntoWall =
				this.velocity.x * -this.wallNormal.x +
				this.velocity.z * -this.wallNormal.z;
			hasIntent = inputIntoWall > 0.3 || velIntoWall > 2;
		}
		if (
			!this.grounded &&
			ledgeEligibleState &&
			this.velocity.y < -config.ledgeMinFallSpeed &&
			this.ledgeGrabCooldown <= 0 &&
			hasIntent
		) {
			const ledge = tryLedgeGrab({
				physics,
				collider: this.collider,
				body: this.body,
				wallNormal: this.wallNormal,
				velocity: this.velocity,
			});
			if (ledge) {
				this.ledgePos = ledge.pos;
				this.ledgeNormal = ledge.normal;
				this.ledgeBodyHandle = ledge.bodyHandle;
				this.body.setTranslation(ledge.pos, true);
				this.velocity.set(0, 0, 0);
				this.state = "ledge_hang";
				this.jumpChain = 0;
				haptic(30);
				this.mesh.position.set(ledge.pos.x, ledge.pos.y, ledge.pos.z);
				return;
			}
		}

		// Now commit wall_slide state if we didn't grab anything.
		if (
			wallHit &&
			this.velocity.y < 0 &&
			this.state !== "ground_pound_start" &&
			this.state !== "ground_pound" &&
			this.state !== "dive"
		) {
			this.state = "wall_slide";
			this.velocity.y = Math.max(this.velocity.y, -2.5);
		}

		// Commit movement
		const corrected = this.controller.computedMovement();
		const pos = this.body.translation();
		const next = {
			x: pos.x + corrected.x,
			y: pos.y + corrected.y,
			z: pos.z + corrected.z,
		};
		this.body.setNextKinematicTranslation(next);

		if (next.y < -20) this.respawn();

		// All visual state (rotation, scale, pose)
		this.updateVisuals(dt);
	}

	private handleLedgeHang(
		input: InputState,
		physics: Physics,
		dt: number,
	): void {
		if (!this.ledgePos) {
			this.climbIntentT = 0;
			this.state = "airborne";
			return;
		}

		// Climb animation in progress: interpolate + skip rest of logic.
		if (this.climbT >= 0) {
			this.climbT += dt;
			const durMs =
				this.climbVariant === "fast"
					? config.ledgeClimbFastMs
					: this.climbVariant === "down"
						? config.ledgeClimbDownMs
						: config.ledgeClimbSlowMs;
			const durSec = durMs / 1000;
			const t = Math.min(1, this.climbT / durSec);
			const eased = t * t * (3 - 2 * t);
			const x =
				this.climbStart.x + (this.climbEnd.x - this.climbStart.x) * eased;
			const y =
				this.climbStart.y + (this.climbEnd.y - this.climbStart.y) * eased;
			const z =
				this.climbStart.z + (this.climbEnd.z - this.climbStart.z) * eased;
			this.body.setTranslation({ x, y, z }, true);
			this.mesh.position.set(x, y, z);
			if (t >= 1) {
				// Fast + slow end on top (grounded). Climb-down ends airborne so
				// the player falls naturally from below the ledge face.
				this.state =
					this.climbVariant === "down" ? "airborne" : "grounded";
				this.ledgePos = null;
				this.ledgeNormal = null;
				this.ledgeBodyHandle = null;
				this.climbT = -1;
				this.climbIntentT = 0;
				this.ledgeGrabCooldown = 0.3;
				if (this.climbVariant === "down") this.velocity.y = 0;
			}
			this.updateVisuals(dt);
			return;
		}

		// Cam-relative input
		const cy = Math.cos(input.cameraYaw);
		const sy = Math.sin(input.cameraYaw);
		const mx = input.moveX * cy + input.moveZ * sy;
		const mz = -input.moveX * sy + input.moveZ * cy;
		// Use ledgeNormal (captured at grab from actual chestHit.normal) — this is
		// more accurate than wallNormal (which comes from coarse 4-cardinal query
		// and often misses non-axis-aligned platform-edge surfaces).
		const ln = this.ledgeNormal ?? this.wallNormal;
		const intoWall = ln
			? new THREE.Vector3(-ln.x, 0, -ln.z).normalize()
			: new THREE.Vector3(
					-Math.sin(this.facingYaw),
					0,
					-Math.cos(this.facingYaw),
				);
		const tangent = ln
			? new THREE.Vector3(-ln.z, 0, ln.x).normalize()
			: new THREE.Vector3(
					Math.cos(this.facingYaw),
					0,
					-Math.sin(this.facingYaw),
				);
		const alongInput = mx * tangent.x + mz * tangent.z;
		const intoWallInput = mx * intoWall.x + mz * intoWall.z;
		const wantsShimmy = Math.abs(alongInput) > config.ledgeShimmyDeadzone;
		const wantsClimb =
			intoWallInput > config.ledgeClimbInputDeadzone && !wantsShimmy;
		const wantsDrop = intoWallInput < -config.ledgeClimbInputDeadzone;

		// Shimmy along ledge tangent
		this.shimmyDir = 0;
		if (wantsShimmy) {
			const dir = Math.sign(alongInput);
			this.shimmyDir = dir;
			const step = config.ledgeShimmySpeed * dir * dt;
			const candidate = {
				x: this.ledgePos.x + tangent.x * step,
				y: this.ledgePos.y,
				z: this.ledgePos.z + tangent.z * step,
			};
			if (verifyLedgeAt(physics, this.collider, ln, candidate)) {
				this.ledgePos = candidate;
			}
		}

		if (wantsClimb) {
			this.climbIntentT += dt;
		} else {
			this.climbIntentT = 0;
		}

		// Target facing: wall-direction if still, tangent-direction if shimmying.
		if (this.shimmyDir !== 0) {
			this.targetYaw = Math.atan2(
				-tangent.x * this.shimmyDir,
				-tangent.z * this.shimmyDir,
			);
		} else {
			this.targetYaw = Math.atan2(-intoWall.x, -intoWall.z);
		}

		// Pin to ledge position
		this.body.setTranslation(this.ledgePos, true);
		this.velocity.set(0, 0, 0);
		this.mesh.position.set(this.ledgePos.x, this.ledgePos.y, this.ledgePos.z);

		// M64-style triggers. Fast climb (A-press) is instant; slow climb
		// (forward-stick) requires hangMin; climb-down (back-stick + crouch)
		// descends to airborne below the ledge face; crouch-tap drops plain.
		const hangMinSec = config.ledgeHangMinMs / 1000;
		const candidateUp = {
			x: this.ledgePos.x + intoWall.x * 0.7,
			y: this.ledgePos.y + HEIGHT + 0.3,
			z: this.ledgePos.z + intoWall.z * 0.7,
		};
		if (input.jumpPressed) {
			if (verifyClearanceAbove(physics, this.collider, candidateUp)) {
				this.climbVariant = "fast";
				this.state = "ledge_climb_fast";
				this.climbStart.set(this.ledgePos.x, this.ledgePos.y, this.ledgePos.z);
				this.climbEnd.set(candidateUp.x, candidateUp.y, candidateUp.z);
				this.climbT = 0;
				this.climbIntentT = 0;
				haptic(20);
			}
		} else if (wantsClimb && this.climbIntentT >= hangMinSec) {
			if (verifyClearanceAbove(physics, this.collider, candidateUp)) {
				this.climbVariant = "slow";
				this.state = "ledge_climb_slow";
				this.climbStart.set(this.ledgePos.x, this.ledgePos.y, this.ledgePos.z);
				this.climbEnd.set(candidateUp.x, candidateUp.y, candidateUp.z);
				this.climbT = 0;
				this.climbIntentT = 0;
				haptic(15);
			} else {
				this.climbIntentT = 0;
			}
		} else if (wantsDrop && input.crouchHeld) {
			// Climb-down: descend past the ledge face. Ends airborne so the
			// player falls naturally from the lower position.
			this.climbVariant = "down";
			this.state = "ledge_climb_down";
			this.climbStart.set(this.ledgePos.x, this.ledgePos.y, this.ledgePos.z);
			this.climbEnd.set(
				this.ledgePos.x - intoWall.x * 0.3,
				this.ledgePos.y - config.ledgeClimbDownDropDist,
				this.ledgePos.z - intoWall.z * 0.3,
			);
			this.climbT = 0;
			this.climbIntentT = 0;
			haptic(10);
		} else if (input.crouchPressed || wantsDrop) {
			this.state = "airborne";
			this.ledgePos = null;
			this.ledgeNormal = null;
			this.ledgeBodyHandle = null;
			this.ledgeGrabCooldown = 0.3;
			this.climbIntentT = 0;
		}
		this.updateVisuals(dt);
	}

	private updateVisuals(dt: number): void {
		if (this.state !== this.prevVisState) {
			this.stateTime = 0;
			this.prevVisState = this.state;
		} else {
			this.stateTime += dt;
		}
		const pose = computePose({
			state: this.state,
			dt,
			facingYaw: this.facingYaw,
			targetYaw: this.targetYaw,
			pitchAngle: this.pitchAngle,
			yawSpin: this.yawSpin,
			jumpChain: this.jumpChain,
			wallNormal: this.wallNormal,
			grounded: this.grounded,
			timeSinceGrounded: this.timeSinceGrounded,
			crouching: this.crouching,
			currentScaleY: this.visualGroup.scale.y,
			landingSquashT: this.landingSquashT,
			stateTime: this.stateTime,
			landingStyle: this.landingStyle,
			landingStyleT: this.landingStyleT,
		});
		this.facingYaw = pose.facingYaw;
		this.pitchAngle = pose.pitchAngle;
		this.yawSpin = pose.yawSpin;
		this.visualGroup.rotation.set(
			pose.renderPitch,
			pose.renderYaw,
			pose.renderRoll,
			"YXZ",
		);
		this.visualGroup.scale.y = pose.scaleY;
		this.visualGroup.position.y = pose.offsetY;

		// Procedural limb posing — lerp each mitten/foot toward state target.
		const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
		const targets = computeLimbs({
			state: this.state,
			horizSpeed,
			accumTime: this.accumTime,
			stateTime: this.stateTime,
			shimmyDir: this.shimmyDir,
			jumpChain: this.jumpChain,
		});
		const limbLerp = Math.min(1, dt * 12);
		this.limbs.armL.position.lerp(targets.armL, limbLerp);
		this.limbs.armR.position.lerp(targets.armR, limbLerp);
		this.limbs.footL.position.lerp(targets.footL, limbLerp);
		this.limbs.footR.position.lerp(targets.footR, limbLerp);
	}

	private applySlopePhysics(dt: number): void {
		if (!this.grounded) return;
		if (this.slopeAngleDeg < 5) return;

		const g = new THREE.Vector3(0, config.gravity, 0);
		const n = this.slopeNormal.clone().normalize();
		const gAlong = g.clone().sub(n.clone().multiplyScalar(g.dot(n)));

		if (this.state === "slope_slide") {
			// No traction — gravity-along dominates. Decay any lateral control remnants.
			this.velocity.x *= 0.98;
			this.velocity.z *= 0.98;
			this.velocity.x += gAlong.x * dt;
			this.velocity.z += gAlong.z * dt;
		} else if (this.state !== "crouch_slide") {
			// Gentle slopes, normal stance: downhill boost if moving with fall direction
			const horizVel = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
			const horizFall = new THREE.Vector3(gAlong.x, 0, gAlong.z);
			if (horizFall.lengthSq() < 1e-4) return;
			const horizFallDir = horizFall.clone().normalize();
			const alignment = horizVel.dot(horizFallDir);
			if (alignment > 0) {
				const boost =
					config.slopeBoost *
					(this.slopeAngleDeg / config.slopeSlideAngleDeg) *
					dt;
				this.velocity.x += horizFallDir.x * boost;
				this.velocity.z += horizFallDir.z * boost;
			}
		}
	}

	private executeWallKick(): void {
		if (!this.wallNormal) return;
		const result = computeWallKick(this.wallNormal);
		this.lastWallKickNormal = { x: this.wallNormal.x, z: this.wallNormal.z };
		this.timeSinceWallKick = 0;
		this.velocity.set(result.velocity.x, result.velocity.y, result.velocity.z);
		this.state = "airborne";
		this.jumpChain = 1;
		this.jumpBufferT = 999;
		this.wallNormal = null;
		this.timeSinceWall = 999;
		this.targetYaw = result.targetYaw;
		this.moveVariant = "wall_kick";
	}

	private executeJump(
		input: InputState,
		horizSpeed: number,
		mx: number,
		mz: number,
	): void {
		this.timeSinceGrounded = 999;
		this.jumpBufferT = 999;
		this.grounded = false;

		const result = computeJump({
			crouchHeld: input.crouchHeld,
			mx,
			mz,
			horizSpeed,
			velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
			facingYaw: this.facingYaw,
			chainOnLanding: this.chainOnLanding,
			timeSinceLanding: this.timeSinceLanding,
			state: this.state,
			inSkid: this.state === "skid",
		});
		this.velocity.set(result.velocity.x, result.velocity.y, result.velocity.z);
		this.state = result.state;
		this.jumpChain = result.jumpChain;
		this.moveVariant = result.moveVariant;

		if (result.facing === "snap-to-velocity") this.snapFacingToVelocity();
		else if (typeof result.facing === "object")
			this.setFacing(result.facing.yaw);

		this.timeSinceLanding = 999;
	}

	private executeDive(
		horizSpeed: number,
		mx: number,
		mz: number,
		fromGround: boolean,
	): void {
		const mag = Math.max(horizSpeed, 1);
		let dx = this.velocity.x / mag;
		let dz = this.velocity.z / mag;
		if (Math.hypot(dx, dz) < 0.5) {
			const inputMag = Math.hypot(mx, mz);
			if (inputMag > 0.1) {
				dx = mx / inputMag;
				dz = mz / inputMag;
			}
		}
		this.velocity.x = dx * config.diveVelXZ;
		this.velocity.z = dz * config.diveVelXZ;
		if (fromGround) {
			// Small upward kick so the dive actually leaves the floor and follows
			// an arc into the stomach-slide landing path. Without it we'd just
			// scrape forward and never trigger the airborne→dive→stomach pipeline.
			this.velocity.y = Math.max(this.velocity.y, 4);
			this.grounded = false;
			this.timeSinceGrounded = 999;
		} else {
			this.velocity.y = config.diveVelY;
		}
		this.state = "dive";
		this.jumpChain = 0;
		this.moveVariant = "dive";
		this.snapFacingToVelocity();
	}

	private executePunch(phase: 1 | 2 | 3): void {
		// Cap forward velocity on entry. M64 ACT_MOVE_PUNCHING caps fVel at 6 u/f.
		const sp = Math.hypot(this.velocity.x, this.velocity.z);
		if (sp > config.punchEntryVelCap) {
			const k = config.punchEntryVelCap / sp;
			this.velocity.x *= k;
			this.velocity.z *= k;
		}
		this.state = phase === 1 ? "punch_1" : phase === 2 ? "punch_2" : "kick";
		this.punchT = 0;
		this.moveVariant = "punch";
		// Lock facing for the duration. The player aims by walking briefly before
		// the punch, then commits — same feel as M64.
		this.setFacing(this.facingYaw);
	}

	private executeSweepKick(): void {
		this.velocity.x = 0;
		this.velocity.z = 0;
		this.state = "sweep_kick";
		this.sweepT = 0;
		this.moveVariant = "sweep_kick";
		// Cancel any pending punch chain.
		this.punchT = 0;
		this.setFacing(this.facingYaw);
	}

	private executeAerialKick(): void {
		// M64 act_jump_kick: forward velocity loses ~1 u/f on entry. Approximate
		// with a 0.95 multiplier (3 u/f → 2.85 u/f; not material, just removes
		// the perfect-conservation feel). Vertical velocity is preserved.
		this.velocity.x *= 0.95;
		this.velocity.z *= 0.95;
		this.state = "aerial_kick";
		this.aerialKickT = 0;
		this.moveVariant = "aerial_kick";
		this.setFacing(this.facingYaw);
	}

	/**
	 * Snapshot body position after a physics step. Engine calls this once per
	 * fixed step (after physics.world.step()). Rotates prev←curr, curr←body.
	 */
	snapshotPhysics(): void {
		this.prevBodyPos.copy(this.currBodyPos);
		const t = this.body.translation();
		this.currBodyPos.set(t.x, t.y, t.z);
	}

	/**
	 * Render-time sync: lerp mesh between prev and curr body snapshot using
	 * alpha = accumulator / FIXED_DT. Called once per rendered frame.
	 * Smooth across refresh-rate mismatch (60Hz physics, 120/144/240Hz display).
	 */
	sync(alpha: number): void {
		this.mesh.position.lerpVectors(this.prevBodyPos, this.currBodyPos, alpha);
	}

	get position(): THREE.Vector3 {
		return this.mesh.position;
	}

	get debug(): DebugInfo {
		return {
			state: this.state,
			vx: this.velocity.x,
			vy: this.velocity.y,
			vz: this.velocity.z,
			speed: Math.hypot(this.velocity.x, this.velocity.z),
			grounded: this.grounded,
			slopeAngleDeg: this.slopeAngleDeg,
			surface: this.surface,
		};
	}

	get comboReady(): boolean {
		const windowSec = config.doubleJumpWindowMs / 1000;
		return (
			this.grounded &&
			this.timeSinceLanding <= windowSec &&
			this.chainOnLanding >= 1 &&
			this.chainOnLanding < 3
		);
	}

	get wallKickReady(): boolean {
		return (
			!this.grounded &&
			!!this.wallNormal &&
			this.timeSinceWall <= config.wallStickMs / 1000
		);
	}

	get facing(): number {
		return this.facingYaw;
	}

	get isMoving(): boolean {
		return Math.hypot(this.velocity.x, this.velocity.z) > 2;
	}

	/** Read-only velocity for external systems (camera look-ahead). */
	get velocityVec(): THREE.Vector3 {
		return this.velocity;
	}

	/** Is player currently in airborne state (for Y-stabilization in cam)? */
	get airborne(): boolean {
		return !this.grounded;
	}

	get inLedgeHang(): boolean {
		return this.state === "ledge_hang";
	}

	/** Consume the pound-landing event (true once per impact). */
	consumePoundImpact(): boolean {
		if (this.poundImpactPending) {
			this.poundImpactPending = false;
			return true;
		}
		return false;
	}

	/** Consume the normal-landing event (set on hard landing, any state). */
	consumeLandEvent(): boolean {
		if (this.landImpactPending) {
			this.landImpactPending = false;
			return true;
		}
		return false;
	}

	/** Consume the skid-start event (set on entering skid state). */
	consumeSkidEvent(): boolean {
		if (this.skidStartPending) {
			this.skidStartPending = false;
			return true;
		}
		return false;
	}

	get colliderRef(): RAPIER.Collider {
		return this.collider;
	}

	/** Hide/show the visual mesh (for first-person toggle). Physics unaffected. */
	setVisible(v: boolean): void {
		this.visualGroup.visible = v;
	}

	private shouldTrackFacingFromVelocity(horizSpeed: number): boolean {
		return (
			horizSpeed > 0.5 &&
			this.state !== "skid" &&
			this.state !== "wall_slide" &&
			!this.isFacingLockedMove()
		);
	}

	private shouldRotateTowardTarget(): boolean {
		return (
			this.state !== "skid" &&
			this.state !== "wall_slide" &&
			!this.isFacingLockedMove()
		);
	}

	private isFacingLockedMove(): boolean {
		return (
			this.state === "backflip" ||
			this.state === "long_jump" ||
			this.state === "side_flip" ||
			this.state === "dive" ||
			this.state === "ground_pound_start" ||
			this.state === "ground_pound" ||
			this.state === "punch_1" ||
			this.state === "punch_2" ||
			this.state === "kick" ||
			this.state === "sweep_kick" ||
			this.state === "aerial_kick" ||
			(this.state === "airborne" && this.jumpChain === 3)
		);
	}

	private snapFacingToVelocity(): void {
		const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
		if (horizSpeed <= 0.001) return;
		this.setFacing(Math.atan2(-this.velocity.x, -this.velocity.z));
	}

	private setFacing(yaw: number): void {
		const normalized = normalizeAngle(yaw);
		this.facingYaw = normalized;
		this.targetYaw = normalized;
	}
}

function approach(current: number, target: number, step: number): number {
	if (current < target) return Math.min(current + step, target);
	if (current > target) return Math.max(current - step, target);
	return current;
}

function lerpToward(current: number, target: number, step: number): number {
	const d = target - current;
	if (Math.abs(d) <= step) return target;
	return current + Math.sign(d) * step;
}

function normalizeAngle(a: number): number {
	while (a > Math.PI) a -= 2 * Math.PI;
	while (a < -Math.PI) a += 2 * Math.PI;
	return a;
}

function angleDiff(target: number, current: number): number {
	return normalizeAngle(target - current);
}

function lerpAngle(current: number, target: number, step: number): number {
	const d = angleDiff(target, current);
	if (Math.abs(d) <= step) return target;
	return current + Math.sign(d) * step;
}

function haptic(ms: number): void {
	if (
		typeof navigator !== "undefined" &&
		typeof navigator.vibrate === "function"
	) {
		navigator.vibrate(ms);
	}
}

function landingDurationFor(variant: MoveVariant): number {
	switch (variant) {
		case "single":
			return config.landSingleMs / 1000;
		case "double":
			return config.landDoubleMs / 1000;
		case "triple":
			return config.landTripleMs / 1000;
		case "backflip":
			return config.landBackflipMs / 1000;
		case "side_flip":
			return config.landSideFlipMs / 1000;
		case "long_jump":
			return config.landLongJumpMs / 1000;
		case "dive":
			return config.landDiveMs / 1000;
		case "wall_kick":
			return config.landWallKickMs / 1000;
		case "ground_pound":
			return config.landGroundPoundMs / 1000;
		case "punch":
			return config.landPunchMs / 1000;
		case "sweep_kick":
			return config.landSweepMs / 1000;
		case "aerial_kick":
			return config.landAerialKickMs / 1000;
	}
}
