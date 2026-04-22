import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from './physics';
import type { InputState } from './input';
import { config } from './config.svelte';

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
	readonly mesh: THREE.Group;
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

	private wallNormal: { x: number; z: number } | null = null;
	private timeSinceWall = 999;

	private ledgePos: { x: number; y: number; z: number } | null = null;
	private ledgeGrabCooldown = 0;

	private startPos: THREE.Vector3;

	constructor(scene: THREE.Scene, physics: Physics, spawn: THREE.Vector3) {
		this.startPos = spawn.clone();

		// Visual: group = body (capsule) + nose (cone pointing -Z local)
		this.mesh = new THREE.Group();
		const bodyGeo = new THREE.CapsuleGeometry(RADIUS, HEIGHT, 4, 8);
		const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe03030, roughness: 0.4 });
		this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
		this.mesh.add(this.bodyMesh);

		const noseGeo = new THREE.ConeGeometry(0.18, 0.4, 10);
		// Cone apex is at +Y by default. Rotate so apex points -Z (model forward).
		noseGeo.rotateX(-Math.PI / 2);
		const noseMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
		this.noseMesh = new THREE.Mesh(noseGeo, noseMat);
		this.noseMesh.position.set(0, EYE_HEIGHT, -RADIUS - 0.1);
		this.mesh.add(this.noseMesh);

		// Small eyes for extra visual feedback (two small dark spheres above nose)
		const eyeGeo = new THREE.SphereGeometry(0.06, 8, 6);
		const eyeMat = new THREE.MeshStandardMaterial({ color: 0x221818, roughness: 0.2 });
		const eL = new THREE.Mesh(eyeGeo, eyeMat);
		eL.position.set(-0.13, EYE_HEIGHT + 0.1, -RADIUS - 0.05);
		const eR = new THREE.Mesh(eyeGeo, eyeMat);
		eR.position.set(0.13, EYE_HEIGHT + 0.1, -RADIUS - 0.05);
		this.mesh.add(eL);
		this.mesh.add(eR);

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

	respawn(): void {
		this.body.setTranslation({ x: this.startPos.x, y: this.startPos.y, z: this.startPos.z }, true);
		this.velocity.set(0, 0, 0);
		this.jumpChain = 0;
		this.state = 'airborne';
		this.ledgePos = null;
	}

	step(dt: number, input: InputState, physics: Physics): void {
		// Query slope/surface FIRST so this frame's movement knows about it.
		this.surface = this.queryGroundSurface(physics);
		const ny = Math.max(-1, Math.min(1, this.slopeNormal.y));
		this.slopeAngleDeg = Math.acos(ny) * (180 / Math.PI);

		// Handle ledge-hang as a separate mini state machine.
		if (this.state === 'ledge_hang') {
			this.handleLedgeHang(input, dt);
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
			if (slopeTooSteep) this.state = 'slope_slide';
			else if (wantsCrouchSlide || wantsDashSlide || this.state === 'crouch_slide') {
				// Enter/stay in crouch_slide while crouch held and moving.
				const sliding =
					input.crouchHeld &&
					Math.hypot(this.velocity.x, this.velocity.z) > 0.5;
				this.state = sliding ? 'crouch_slide' : 'grounded';
			} else if (this.state === 'skid') {
				this.skidT += dt;
				if (this.skidT >= config.skidDurationMs / 1000) this.state = 'grounded';
			} else if (this.state !== 'slope_slide' && this.state !== 'crouch_slide') {
				this.state = 'grounded';
			}
		}

		// Horizontal accel/decel. Locked states keep their momentum.
		const momentumLocked =
			(!this.grounded &&
				(this.state === 'long_jump' ||
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

			// Skid-turn detection: while grounded + fast + input reverses direction.
			const horizSp = Math.hypot(this.velocity.x, this.velocity.z);
			if (this.grounded && this.state === 'grounded' && horizSp > 4 && hasInput) {
				const inputYaw = Math.atan2(-mx, -mz);
				const deltaYaw = angleDiff(inputYaw, this.facingYaw);
				if (Math.abs(deltaYaw) > (config.skidReverseDeg * Math.PI) / 180) {
					this.state = 'skid';
					this.skidT = 0;
					this.targetYaw = inputYaw;
					// Kill incoming accel — player brakes briefly
					this.velocity.x *= 0.5;
					this.velocity.z *= 0.5;
				}
			}
		}

		// Slide surfaces: friction-decay on crouch-slide (gentle), but slope-slide ignores friction.
		if (this.state === 'crouch_slide') {
			// Gentle friction decay (keep momentum feel)
			const f = 0.9 * dt;
			this.velocity.x = approach(this.velocity.x, 0, 5 * dt);
			this.velocity.z = approach(this.velocity.z, 0, 5 * dt);
			// Apply slope-along if on slope (preserves gliding downhill)
			if (this.slopeAngleDeg >= 5) {
				const g = new THREE.Vector3(0, config.gravity, 0);
				const n = this.slopeNormal.clone().normalize();
				const gAlong = g.clone().sub(n.clone().multiplyScalar(g.dot(n)));
				this.velocity.x += gAlong.x * dt * 0.7;
				this.velocity.z += gAlong.z * dt * 0.7;
			}
			// Suppress unused: avoid TS error for f
			void f;
		}

		this.timeSinceGrounded += dt;
		if (this.grounded) {
			this.timeSinceGrounded = 0;
			this.timeSinceLanding += dt;
		}

		// Track facing from velocity (desired yaw).
		const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
		if (horizSpeed > 0.5 && this.state !== 'skid') {
			this.targetYaw = Math.atan2(-this.velocity.x, -this.velocity.z);
		}

		// Jump buffer
		if (input.jumpPressed) this.jumpBufferT = 0;
		else this.jumpBufferT += dt;

		const coyoteSec = config.coyoteMs / 1000;
		const bufferSec = config.bufferMs / 1000;
		const wallStickSec = config.wallStickMs / 1000;
		const canGroundJump =
			this.timeSinceGrounded <= coyoteSec && this.jumpBufferT <= bufferSec;
		const canWallKick =
			!this.grounded &&
			!!this.wallNormal &&
			this.timeSinceWall <= wallStickSec &&
			this.jumpBufferT <= bufferSec;

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

		// Wall detection (airborne)
		this.timeSinceWall += dt;
		const wallHit = this.grounded ? null : this.queryWallContact(physics);
		if (wallHit) {
			this.wallNormal = wallHit;
			this.timeSinceWall = 0;
			if (this.velocity.y < 0 && this.state !== 'ground_pound' && this.state !== 'dive') {
				this.state = 'wall_slide';
				this.velocity.y = Math.max(this.velocity.y, -2.5);
			}
		}

		// Ledge grab attempt (airborne falling + ledge in front)
		if (
			this.state === 'airborne' &&
			this.velocity.y < 0 &&
			this.ledgeGrabCooldown <= 0
		) {
			const ledge = this.tryLedgeGrab(physics);
			if (ledge) {
				this.ledgePos = ledge;
				this.body.setTranslation(ledge, true);
				this.velocity.set(0, 0, 0);
				this.state = 'ledge_hang';
				this.jumpChain = 0;
				haptic(30);
				// Don't continue normal movement; ledge_hang will take over next frame.
				this.mesh.position.set(ledge.x, ledge.y, ledge.z);
				return;
			}
		}

		// Commit movement
		const corrected = this.controller.computedMovement();
		const pos = this.body.translation();
		const next = { x: pos.x + corrected.x, y: pos.y + corrected.y, z: pos.z + corrected.z };
		this.body.setNextKinematicTranslation(next);

		if (next.y < -20) this.respawn();

		// Smooth facing rotation (skip during skid = frozen, then snap to target after skid ends)
		this.updateFacingRotation(dt);
	}

	private handleLedgeHang(input: InputState, dt: number): void {
		if (!this.ledgePos) {
			this.state = 'airborne';
			return;
		}
		// Keep player pinned at ledge position
		this.body.setTranslation(this.ledgePos, true);
		this.velocity.set(0, 0, 0);
		this.mesh.position.set(this.ledgePos.x, this.ledgePos.y, this.ledgePos.z);

		// Up input → pull up (snap player onto ledge top)
		if (input.moveZ < -0.6) {
			const facing = new THREE.Vector3(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));
			const up = {
				x: this.ledgePos.x + facing.x * 0.6,
				y: this.ledgePos.y + HEIGHT + 0.3,
				z: this.ledgePos.z + facing.z * 0.6
			};
			this.body.setTranslation(up, true);
			this.mesh.position.set(up.x, up.y, up.z);
			this.state = 'grounded';
			this.ledgePos = null;
			this.ledgeGrabCooldown = 0.3;
			haptic(20);
		} else if (input.jumpPressed) {
			// Jump off ledge
			this.velocity.y = config.jumpVel;
			this.state = 'airborne';
			this.ledgePos = null;
			this.ledgeGrabCooldown = 0.3;
			this.jumpChain = 1;
			haptic(15);
		} else if (input.crouchPressed || input.moveZ > 0.6) {
			// Drop
			this.state = 'airborne';
			this.ledgePos = null;
			this.ledgeGrabCooldown = 0.3;
		}
		this.updateFacingRotation(dt);
	}

	private tryLedgeGrab(physics: Physics): { x: number; y: number; z: number } | null {
		const { world, rapier } = physics;
		const origin = this.body.translation();
		// Only grab when moving "toward" a wall — use facing yaw for forward direction
		const fwd = new THREE.Vector3(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));
		const reach = config.ledgeForwardReach;

		// 1. Cast from chest forward → must hit wall
		const chestOrigin = { x: origin.x, y: origin.y + 0.1, z: origin.z };
		const rayChest = new rapier.Ray(chestOrigin, { x: fwd.x, y: 0, z: fwd.z });
		const chestHit = world.castRayAndGetNormal(
			rayChest,
			reach,
			true,
			undefined,
			undefined,
			this.collider
		);
		if (!chestHit || Math.abs(chestHit.normal.y) > 0.5) return null;

		// 2. Cast from above head forward → must miss (empty air above wall)
		const headOrigin = {
			x: origin.x,
			y: origin.y + HEIGHT / 2 + config.ledgeUpReach,
			z: origin.z
		};
		const rayHead = new rapier.Ray(headOrigin, { x: fwd.x, y: 0, z: fwd.z });
		const headHit = world.castRay(
			rayHead,
			reach + 0.1,
			true,
			undefined,
			undefined,
			this.collider
		);
		if (headHit) return null;

		// 3. Cast down from above the wall to find its top
		const aboveWall = {
			x: origin.x + fwd.x * (reach + 0.05),
			y: origin.y + HEIGHT / 2 + config.ledgeUpReach,
			z: origin.z + fwd.z * (reach + 0.05)
		};
		const rayDown = new rapier.Ray(aboveWall, { x: 0, y: -1, z: 0 });
		const downHit = world.castRayAndGetNormal(
			rayDown,
			config.ledgeUpReach + 0.3,
			true,
			undefined,
			undefined,
			this.collider
		);
		if (!downHit || downHit.normal.y < 0.7) return null;

		// Ledge top Y
		const ledgeY = aboveWall.y - downHit.timeOfImpact;
		// Snap player so chest is just below ledge top, slightly off the wall
		const grabY = ledgeY - HEIGHT / 2 - 0.05;
		// Position at wall-hit minus RADIUS gap
		const wallX = origin.x + fwd.x * chestHit.timeOfImpact;
		const wallZ = origin.z + fwd.z * chestHit.timeOfImpact;
		return {
			x: wallX - fwd.x * (RADIUS + 0.05),
			y: grabY,
			z: wallZ - fwd.z * (RADIUS + 0.05)
		};
	}

	private updateFacingRotation(dt: number): void {
		// During skid, freeze rotation until skid ends
		if (this.state === 'skid') {
			this.mesh.rotation.y = this.facingYaw;
			return;
		}
		const step = config.rotationSpeed * dt;
		this.facingYaw = lerpAngle(this.facingYaw, this.targetYaw, step);
		this.mesh.rotation.y = this.facingYaw;
	}

	private queryGroundSurface(physics: Physics): string {
		if (!this.grounded) {
			this.slopeNormal.set(0, 1, 0);
			return 'air';
		}
		const { world, rapier } = physics;
		const origin = this.body.translation();
		const ray = new rapier.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: 0, y: -1, z: 0 });
		const hit = world.castRayAndGetNormal(ray, HEIGHT, true, undefined, undefined, this.collider);
		if (!hit) {
			this.slopeNormal.set(0, 1, 0);
			return 'grass';
		}
		this.slopeNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
		const col = world.getCollider(hit.collider);
		if (col && col.friction() < 0.1) return 'ice';
		return 'grass';
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

	private queryWallContact(physics: Physics): { x: number; z: number } | null {
		const { world, rapier } = physics;
		const origin = this.body.translation();
		const reach = RADIUS + 0.15;
		const dirs: [number, number][] = [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1]
		];
		for (const [dx, dz] of dirs) {
			const ray = new rapier.Ray(
				{ x: origin.x, y: origin.y, z: origin.z },
				{ x: dx, y: 0, z: dz }
			);
			const hit = world.castRayAndGetNormal(ray, reach, true, undefined, undefined, this.collider);
			if (hit && Math.abs(hit.normal.y) < 0.5) {
				return { x: hit.normal.x, z: hit.normal.z };
			}
		}
		return null;
	}

	private executeWallKick(): void {
		if (!this.wallNormal) return;
		this.velocity.y = config.wallKickVelY;
		this.velocity.x = this.wallNormal.x * config.wallKickVelXZ;
		this.velocity.z = this.wallNormal.z * config.wallKickVelXZ;
		this.state = 'airborne';
		this.jumpChain = 1;
		this.jumpBufferT = 999;
		this.wallNormal = null;
		this.timeSinceWall = 999;
		// Face away from wall
		this.targetYaw = Math.atan2(-this.velocity.x, -this.velocity.z);
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

		const inputMag = Math.hypot(mx, mz);
		const inputDirX = inputMag > 0.3 ? mx / inputMag : 0;
		const inputDirZ = inputMag > 0.3 ? mz / inputMag : 0;

		const velDirX = horizSpeed > 0.5 ? this.velocity.x / horizSpeed : 0;
		const velDirZ = horizSpeed > 0.5 ? this.velocity.z / horizSpeed : 0;
		const reversed =
			inputMag > 0.5 && horizSpeed > 0.5 && inputDirX * velDirX + inputDirZ * velDirZ < -0.5;

		const windowSec = config.doubleJumpWindowMs / 1000;
		const canChain =
			this.timeSinceLanding <= windowSec && this.chainOnLanding >= 1 && horizSpeed > 2;

		if (input.crouchHeld && horizSpeed > 3) {
			this.velocity.y = config.longJumpVelY;
			const dirX = velDirX || inputDirX;
			const dirZ = velDirZ || inputDirZ;
			this.velocity.x = dirX * config.longJumpVelXZ;
			this.velocity.z = dirZ * config.longJumpVelXZ;
			this.state = 'long_jump';
			this.jumpChain = 0;
		} else if (input.crouchHeld) {
			this.velocity.y = config.backflipVelY;
			const facing = new THREE.Vector3(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));
			this.velocity.x = -facing.x * Math.abs(config.backflipVelXZ);
			this.velocity.z = -facing.z * Math.abs(config.backflipVelXZ);
			this.state = 'backflip';
			this.jumpChain = 0;
		} else if (reversed && horizSpeed > 3) {
			this.velocity.y = config.sideFlipVelY;
			this.velocity.x = inputDirX * config.longJumpVelXZ * 0.6;
			this.velocity.z = inputDirZ * config.longJumpVelXZ * 0.6;
			this.state = 'side_flip';
			this.jumpChain = 0;
		} else if (canChain) {
			this.jumpChain = this.chainOnLanding + 1;
			if (this.jumpChain >= 3) {
				this.velocity.y = config.tripleJumpVel;
				this.jumpChain = 3;
			} else {
				// Running-jump height bonus (M64: +0.25 × fVel on double, scaled)
				this.velocity.y = config.doubleJumpVel + config.runDoubleJumpBonus * horizSpeed;
			}
			this.state = 'airborne';
		} else {
			// Normal jump with running bonus
			this.velocity.y = config.jumpVel + config.runJumpBonus * horizSpeed;
			this.jumpChain = 1;
			this.state = 'airborne';
		}

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
}

function approach(current: number, target: number, step: number): number {
	if (current < target) return Math.min(current + step, target);
	if (current > target) return Math.max(current - step, target);
	return current;
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
