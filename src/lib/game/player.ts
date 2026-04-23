import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from './physics';
import type { InputState } from './input';
import type { MovingPlatform } from './world';
import { config } from './config.svelte';
import {
	queryGroundSurface,
	queryWallContact,
	tryLedgeGrab,
	verifyLedgeAt,
	type WallNormal
} from './player-queries';
import { computePose } from './player-visuals';
import { buildPlayerMeshes } from './player-mesh';
import { computeJump, computeWallKick } from './player-jumps';

const RADIUS = 0.4;
const HEIGHT = 0.8;
const EYE_HEIGHT = 0.3;

export type PlayerState =
	| 'grounded'
	| 'airborne'
	| 'wall_slide'
	| 'ground_pound'
	| 'dive'
	| 'long_jump'
	| 'backflip'
	| 'side_flip'
	| 'slope_slide'
	| 'crouch_slide'
	| 'skid'
	| 'ledge_hang';

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
	private bodyMesh: THREE.Mesh;
	private noseMesh: THREE.Mesh;
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
	private state: PlayerState = 'airborne';
	private surface = 'air';
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

	private ledgePos: { x: number; y: number; z: number } | null = null;
	private ledgeGrabCooldown = 0;

	// One-shot event flag consumed by engine (camera shake on pound landing).
	private poundImpactPending = false;

	// Visual state
	private pitchAngle = 0; // accumulated flip rotation (radians)
	private yawSpin = 0; // extra yaw for side-flip pirouette
	private crouching = false;

	private startPos: THREE.Vector3;

	constructor(scene: THREE.Scene, physics: Physics, spawn: THREE.Vector3) {
		this.startPos = spawn.clone();

		const meshes = buildPlayerMeshes();
		this.mesh = meshes.outer;
		this.visualGroup = meshes.inner;
		this.bodyMesh = meshes.body;
		this.noseMesh = meshes.nose;
		this.mesh.position.copy(spawn);
		scene.add(this.mesh);

		const { world, rapier } = physics;
		const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
			spawn.x,
			spawn.y,
			spawn.z
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
			{ x: 0, y: -1, z: 0 }
		);
		const hit = world.castRay(ray, HEIGHT + 0.5, true, undefined, undefined, this.collider);
		if (!hit) return;
		const parentBody = hit.collider.parent();
		if (!parentBody) return;
		for (const p of platforms) {
			if (parentBody.handle === p.bodyHandle) {
				this.body.setTranslation(
					{ x: origin.x + p.delta.x, y: origin.y + p.delta.y, z: origin.z + p.delta.z },
					true
				);
				return;
			}
		}
	}

	respawn(): void {
		this.body.setTranslation({ x: this.startPos.x, y: this.startPos.y, z: this.startPos.z }, true);
		this.velocity.set(0, 0, 0);
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
		this.ledgeGrabCooldown = 0;
		this.climbT = -1;
		this.shimmyDir = 0;
		this.climbIntentT = 0;
		this.skidT = 999;
		this.pitchAngle = 0;
		this.yawSpin = 0;
		this.crouching = false;
		this.state = 'airborne';
	}

	step(dt: number, input: InputState, physics: Physics): void {
		// Track crouch for visual purposes (outlives input frame)
		this.crouching = input.crouchHeld;

		// Query slope/surface FIRST so this frame's movement knows about it.
		this.surface = this.grounded
			? queryGroundSurface(physics, this.collider, this.body, this.slopeNormal)
			: (this.slopeNormal.set(0, 1, 0), 'air');
		const ny = Math.max(-1, Math.min(1, this.slopeNormal.y));
		this.slopeAngleDeg = Math.acos(ny) * (180 / Math.PI);

		// Handle ledge-hang as a separate mini state machine.
		if (this.state === 'ledge_hang') {
			this.handleLedgeHang(input, physics, dt);
			return;
		}
		this.ledgeGrabCooldown = Math.max(0, this.ledgeGrabCooldown - dt);

		// Camera-relative input → world.
		const cy = Math.cos(input.cameraYaw);
		const sy = Math.sin(input.cameraYaw);
		const mx = input.moveX * cy + input.moveZ * sy;
		const mz = -input.moveX * sy + input.moveZ * cy;

		const speedTarget = config.moveSpeed;
		const targetX = mx * speedTarget;
		const targetZ = mz * speedTarget;

		const hasInput = Math.abs(mx) > 0.01 || Math.abs(mz) > 0.01;
		const onIce = this.surface === 'ice';

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
			this.state !== 'crouch_slide';

		// Update state based on grounded context.
		if (this.grounded) {
			if (slopeTooSteep) {
				this.state = 'slope_slide';
			} else if (wantsCrouchSlide || wantsDashSlide || this.state === 'crouch_slide') {
				const sliding =
					input.crouchHeld &&
					Math.hypot(this.velocity.x, this.velocity.z) > 0.5;
				this.state = sliding ? 'crouch_slide' : 'grounded';
			} else if (this.state === 'skid') {
				this.skidT += dt;
				if (this.skidT >= config.skidDurationMs / 1000) this.state = 'grounded';
			} else {
				this.state = 'grounded';
			}
		}

		// Horizontal accel/decel. Locked states keep their momentum.
			const momentumLocked =
				(!this.grounded &&
					(this.state === 'long_jump' ||
						this.state === 'backflip' ||
						this.state === 'side_flip' ||
						this.state === 'dive' ||
						this.state === 'ground_pound')) ||
				this.state === 'slope_slide' ||
				this.state === 'crouch_slide' ||
			this.state === 'skid';

		let groundRate: number;
		if (hasInput) groundRate = onIce ? config.accel * config.iceFriction : config.accel;
		else groundRate = onIce ? config.decel * config.iceFriction : config.decel;
		const accelRate = this.grounded ? groundRate : config.accel * config.airControl;

		if (!momentumLocked) {
			this.velocity.x = approach(this.velocity.x, targetX, accelRate * dt);
			this.velocity.z = approach(this.velocity.z, targetZ, accelRate * dt);

			// Skid-turn detection: grounded + fast + input reverses direction.
			// M64 uses this window to allow A-press = side flip. Visual: lean back + freeze.
			const horizSp = Math.hypot(this.velocity.x, this.velocity.z);
			if (this.grounded && this.state === 'grounded' && horizSp > 4 && hasInput) {
				const inputYaw = Math.atan2(-mx, -mz);
				const deltaYaw = angleDiff(inputYaw, this.facingYaw);
				if (Math.abs(deltaYaw) > (config.skidReverseDeg * Math.PI) / 180) {
					this.state = 'skid';
					this.skidT = 0;
					this.targetYaw = inputYaw;
					// Preserve some momentum — player keeps skidding a bit before turning
					this.velocity.x *= config.skidVelocityCut;
					this.velocity.z *= config.skidVelocityCut;
				}
			}
		}

		// Crouch-slide: gentle friction decay + downhill boost if on slope.
		if (this.state === 'crouch_slide') {
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

		// Aerial actions (ground pound / dive)
		if (!this.grounded && this.state !== 'ground_pound' && this.state !== 'dive') {
			const triggerGP =
				input.crouchPressed || (input.actionPressed && horizSpeed < 2.5);
			const triggerDive = input.actionPressed && horizSpeed >= 2.5;
				if (triggerGP) {
					this.velocity.x = 0;
					this.velocity.z = 0;
					this.velocity.y = config.groundPoundVel;
					this.state = 'ground_pound';
					this.jumpChain = 0;
					this.setFacing(this.facingYaw);
					haptic(15);
				} else if (triggerDive) {
					const mag = Math.max(horizSpeed, 1);
					const dx = this.velocity.x / mag;
					const dz = this.velocity.z / mag;
				this.velocity.x = dx * config.diveVelXZ;
					this.velocity.z = dz * config.diveVelXZ;
					this.velocity.y = config.diveVelY;
					this.state = 'dive';
					this.jumpChain = 0;
					this.snapFacingToVelocity();
					haptic(15);
				}
			}

		// Variable jump cut (M64-style gravity multiplier)
		const cuttable =
			this.state === 'airborne' &&
			(this.jumpChain === 1 || this.jumpChain === 2 || this.jumpChain === 3);
		const cutActive = cuttable && !input.jumpHeld && this.velocity.y > 0;
		let gravMult = cutActive ? config.jumpAscentCutMult : 1;

		// Wall-slide cling: reduced gravity while hugging wall
		if (this.state === 'wall_slide') gravMult *= config.wallSlideGravityMult;

		this.velocity.y += config.gravity * gravMult * dt;
		if (this.velocity.y < -config.terminalVel) this.velocity.y = -config.terminalVel;

		const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
		this.controller.computeColliderMovement(this.collider, desired);

		const wasGrounded = this.grounded;
		this.grounded = this.controller.computedGrounded();
		if (this.grounded) {
			if (!wasGrounded) {
				const fellFast = this.velocity.y < -15;
				if (this.state === 'ground_pound') {
					this.velocity.y = config.groundPoundBounce;
					this.poundImpactPending = true;
					haptic(60);
				} else if (this.velocity.y < 0) {
					this.velocity.y = 0;
				}
				if (this.state === 'dive') {
					this.velocity.x *= 0.3;
					this.velocity.z *= 0.3;
				}
				if (fellFast && this.state !== 'ground_pound') haptic(25);
				this.timeSinceLanding = 0;
				this.chainOnLanding = this.jumpChain;
				this.jumpChain = 0;
				// State will be re-evaluated top-of-loop next tick
				this.state = 'grounded';
			} else if (this.velocity.y < 0) {
				this.velocity.y = 0;
			}
		} else if (wasGrounded) {
			this.state = 'airborne';
		}

		// Apply slope physics for slope_slide state (after grounded updates)
		this.applySlopePhysics(dt);

		// Wall detection (capture contact only — state change happens after ledge check).
		this.timeSinceWall += dt;
		const wallHit = this.grounded ? null : queryWallContact(physics, this.collider, this.body);
		if (wallHit) {
			this.wallNormal = wallHit;
			this.timeSinceWall = 0;
		}

		// Ledge grab FIRST so wall_slide doesn't lock us out. Require user intent
		// (stick pressed toward wall) OR decisive velocity-into-wall, so drifting
		// past a wall doesn't magnet-snap.
		const horizSp = Math.hypot(this.velocity.x, this.velocity.z);
		const ledgeEligibleState =
			this.state === 'airborne' || this.state === 'wall_slide';
		let hasIntent = false;
		if (this.wallNormal) {
			const inputMag = Math.hypot(mx, mz);
			const inputIntoWall =
				inputMag > 0.3
					? (mx * -this.wallNormal.x + mz * -this.wallNormal.z) / inputMag
					: 0;
			const velIntoWall =
				this.velocity.x * -this.wallNormal.x + this.velocity.z * -this.wallNormal.z;
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
				velocity: this.velocity
			});
			if (ledge) {
				this.ledgePos = ledge;
				this.body.setTranslation(ledge, true);
				this.velocity.set(0, 0, 0);
				this.state = 'ledge_hang';
				this.jumpChain = 0;
				haptic(30);
				this.mesh.position.set(ledge.x, ledge.y, ledge.z);
				return;
			}
		}

		// Now commit wall_slide state if we didn't grab anything.
		if (wallHit && this.velocity.y < 0 && this.state !== 'ground_pound' && this.state !== 'dive') {
			this.state = 'wall_slide';
			this.velocity.y = Math.max(this.velocity.y, -2.5);
		}

		// Commit movement
		const corrected = this.controller.computedMovement();
		const pos = this.body.translation();
		const next = { x: pos.x + corrected.x, y: pos.y + corrected.y, z: pos.z + corrected.z };
		this.body.setNextKinematicTranslation(next);

		if (next.y < -20) this.respawn();

		// All visual state (rotation, scale, pose)
		this.updateVisuals(dt);
	}

	private handleLedgeHang(input: InputState, physics: Physics, dt: number): void {
		if (!this.ledgePos) {
			this.climbIntentT = 0;
			this.state = 'airborne';
			return;
		}

		// Climb animation in progress: interpolate + skip rest of logic.
		if (this.climbT >= 0) {
			this.climbT += dt;
			const durSec = config.ledgeClimbDurationMs / 1000;
			const t = Math.min(1, this.climbT / durSec);
			const eased = t * t * (3 - 2 * t);
			const x = this.climbStart.x + (this.climbEnd.x - this.climbStart.x) * eased;
			const y = this.climbStart.y + (this.climbEnd.y - this.climbStart.y) * eased;
			const z = this.climbStart.z + (this.climbEnd.z - this.climbStart.z) * eased;
			this.body.setTranslation({ x, y, z }, true);
			this.mesh.position.set(x, y, z);
			if (t >= 1) {
				this.state = 'grounded';
				this.ledgePos = null;
				this.climbT = -1;
				this.climbIntentT = 0;
				this.ledgeGrabCooldown = 0.3;
			}
			this.updateVisuals(dt);
			return;
		}

		// Cam-relative input
		const cy = Math.cos(input.cameraYaw);
		const sy = Math.sin(input.cameraYaw);
		const mx = input.moveX * cy + input.moveZ * sy;
		const mz = -input.moveX * sy + input.moveZ * cy;
		const intoWall = this.wallNormal
			? new THREE.Vector3(-this.wallNormal.x, 0, -this.wallNormal.z).normalize()
			: new THREE.Vector3(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));
		const tangent = this.wallNormal
			? new THREE.Vector3(-this.wallNormal.z, 0, this.wallNormal.x).normalize()
			: new THREE.Vector3(Math.cos(this.facingYaw), 0, -Math.sin(this.facingYaw));
		const alongInput = mx * tangent.x + mz * tangent.z;
		const intoWallInput = mx * intoWall.x + mz * intoWall.z;
		const wantsShimmy = Math.abs(alongInput) > config.ledgeShimmyDeadzone;
		const wantsClimb = intoWallInput > config.ledgeClimbInputDeadzone && !wantsShimmy;
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
				z: this.ledgePos.z + tangent.z * step
			};
			if (verifyLedgeAt(physics, this.collider, this.wallNormal, candidate)) {
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
			this.targetYaw = Math.atan2(-tangent.x * this.shimmyDir, -tangent.z * this.shimmyDir);
		} else {
			this.targetYaw = Math.atan2(-intoWall.x, -intoWall.z);
		}

		// Pin to ledge position
		this.body.setTranslation(this.ledgePos, true);
		this.velocity.set(0, 0, 0);
		this.mesh.position.set(this.ledgePos.x, this.ledgePos.y, this.ledgePos.z);

		const climbCommitSec = config.ledgeClimbCommitMs / 1000;
		if (this.climbIntentT >= climbCommitSec) {
			// Start climb animation — lerp from hang pos to standing on top over duration.
			this.climbStart.set(this.ledgePos.x, this.ledgePos.y, this.ledgePos.z);
			this.climbEnd.set(
				this.ledgePos.x + intoWall.x * 0.7,
				this.ledgePos.y + HEIGHT + 0.3,
				this.ledgePos.z + intoWall.z * 0.7
			);
			this.climbT = 0;
			this.climbIntentT = 0;
			haptic(20);
		} else if (input.jumpPressed) {
			this.velocity.y = config.jumpVel;
			this.state = 'airborne';
			this.ledgePos = null;
			this.ledgeGrabCooldown = 0.3;
			this.climbIntentT = 0;
			this.jumpChain = 1;
			haptic(15);
		} else if (input.crouchPressed || wantsDrop) {
			this.state = 'airborne';
			this.ledgePos = null;
			this.ledgeGrabCooldown = 0.3;
			this.climbIntentT = 0;
		}
		this.updateVisuals(dt);
	}

	private updateVisuals(dt: number): void {
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
			currentScaleY: this.visualGroup.scale.y
		});
		this.facingYaw = pose.facingYaw;
		this.pitchAngle = pose.pitchAngle;
		this.yawSpin = pose.yawSpin;
		this.visualGroup.rotation.set(pose.renderPitch, pose.renderYaw, 0, 'YXZ');
		this.visualGroup.scale.y = pose.scaleY;
		this.visualGroup.position.y = pose.offsetY;
	}

	private applySlopePhysics(dt: number): void {
		if (!this.grounded) return;
		if (this.slopeAngleDeg < 5) return;

		const g = new THREE.Vector3(0, config.gravity, 0);
		const n = this.slopeNormal.clone().normalize();
		const gAlong = g.clone().sub(n.clone().multiplyScalar(g.dot(n)));

		if (this.state === 'slope_slide') {
			// No traction — gravity-along dominates. Decay any lateral control remnants.
			this.velocity.x *= 0.98;
			this.velocity.z *= 0.98;
			this.velocity.x += gAlong.x * dt;
			this.velocity.z += gAlong.z * dt;
		} else if (this.state !== 'crouch_slide') {
			// Gentle slopes, normal stance: downhill boost if moving with fall direction
			const horizVel = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
			const horizFall = new THREE.Vector3(gAlong.x, 0, gAlong.z);
			if (horizFall.lengthSq() < 1e-4) return;
			const horizFallDir = horizFall.clone().normalize();
			const alignment = horizVel.dot(horizFallDir);
			if (alignment > 0) {
				const boost = config.slopeBoost * (this.slopeAngleDeg / config.slopeSlideAngleDeg) * dt;
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
		this.state = 'airborne';
		this.jumpChain = 1;
		this.jumpBufferT = 999;
		this.wallNormal = null;
		this.timeSinceWall = 999;
		this.targetYaw = result.targetYaw;
	}

	private executeJump(
		input: InputState,
		horizSpeed: number,
		mx: number,
		mz: number
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
			timeSinceLanding: this.timeSinceLanding
		});
		this.velocity.set(result.velocity.x, result.velocity.y, result.velocity.z);
		this.state = result.state;
		this.jumpChain = result.jumpChain;

		if (result.facing === 'snap-to-velocity') this.snapFacingToVelocity();
		else if (typeof result.facing === 'object') this.setFacing(result.facing.yaw);

		this.timeSinceLanding = 999;
	}

	sync(): void {
		const t = this.body.translation();
		this.mesh.position.set(t.x, t.y, t.z);
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
			surface: this.surface
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
			!this.grounded && !!this.wallNormal && this.timeSinceWall <= config.wallStickMs / 1000
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
		return this.state === 'ledge_hang';
	}

	/** Consume the pound-landing event (true once per impact). */
	consumePoundImpact(): boolean {
		if (this.poundImpactPending) {
			this.poundImpactPending = false;
			return true;
		}
		return false;
	}

	/** Hide/show the visual mesh (for first-person toggle). Physics unaffected. */
	setVisible(v: boolean): void {
		this.visualGroup.visible = v;
	}

	private shouldTrackFacingFromVelocity(horizSpeed: number): boolean {
		return (
			horizSpeed > 0.5 &&
			this.state !== 'skid' &&
			this.state !== 'wall_slide' &&
			!this.isFacingLockedMove()
		);
	}

	private shouldRotateTowardTarget(): boolean {
		return (
			this.state !== 'skid' &&
			this.state !== 'wall_slide' &&
			!this.isFacingLockedMove()
		);
	}

	private isFacingLockedMove(): boolean {
		return (
			this.state === 'backflip' ||
			this.state === 'long_jump' ||
			this.state === 'side_flip' ||
			this.state === 'dive' ||
			this.state === 'ground_pound' ||
			(this.state === 'airborne' && this.jumpChain === 3)
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
	if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
		navigator.vibrate(ms);
	}
}
