import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from './physics';
import type { InputState } from './input';
import { config } from './config.svelte';

const RADIUS = 0.4;
const HEIGHT = 0.8;

export type PlayerState =
	| 'grounded'
	| 'airborne'
	| 'wall_slide'
	| 'ground_pound'
	| 'dive'
	| 'long_jump'
	| 'backflip'
	| 'side_flip';

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
	readonly mesh: THREE.Mesh;
	private body: RAPIER.RigidBody;
	private controller: RAPIER.KinematicCharacterController;
	private collider: RAPIER.Collider;

	private velocity = new THREE.Vector3();
	private grounded = false;
	private timeSinceGrounded = 999;
	private jumpBufferT = 999;
	private timeSinceLanding = 999;
	private jumpChain = 0; // 0=none, 1=single, 2=double, 3=triple
	private chainOnLanding = 0; // jumpChain at moment of last landing
	private state: PlayerState = 'airborne';
	private surface = 'air';
	private slopeNormal = new THREE.Vector3(0, 1, 0);
	private facing = new THREE.Vector3(0, 0, -1); // last non-zero movement dir
	private wallNormal: { x: number; z: number } | null = null;
	private timeSinceWall = 999;
	private startPos: THREE.Vector3;

	constructor(scene: THREE.Scene, physics: Physics, spawn: THREE.Vector3) {
		this.startPos = spawn.clone();

		const geo = new THREE.CapsuleGeometry(RADIUS, HEIGHT, 4, 8);
		const mat = new THREE.MeshStandardMaterial({ color: 0xe03030, roughness: 0.4 });
		this.mesh = new THREE.Mesh(geo, mat);
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
	}

	step(dt: number, input: InputState, physics: Physics): void {
		// Transform input by camera yaw so W always means "away from camera".
		const cy = Math.cos(input.cameraYaw);
		const sy = Math.sin(input.cameraYaw);
		const mx = input.moveX * cy + input.moveZ * sy;
		const mz = -input.moveX * sy + input.moveZ * cy;

		const speedTarget = config.moveSpeed;
		const targetX = mx * speedTarget;
		const targetZ = mz * speedTarget;

		// Ground accel/decel vs air control. Ice = tiny decel (slippery).
		const hasInput = Math.abs(mx) > 0.01 || Math.abs(mz) > 0.01;
		const onIce = this.surface === 'ice';
		let groundRate: number;
		if (hasInput) groundRate = onIce ? config.accel * config.iceFriction : config.accel;
		else groundRate = onIce ? config.decel * config.iceFriction : config.decel;
		const accelRate = this.grounded ? groundRate : config.accel * config.airControl;

		// During special-air states momentum is locked (jumpers keep their impulse)
		const momentumLocked =
			!this.grounded &&
			(this.state === 'long_jump' ||
				this.state === 'side_flip' ||
				this.state === 'dive' ||
				this.state === 'ground_pound');
		if (!momentumLocked) {
			this.velocity.x = approach(this.velocity.x, targetX, accelRate * dt);
			this.velocity.z = approach(this.velocity.z, targetZ, accelRate * dt);
		}

		this.timeSinceGrounded += dt;
		if (this.grounded) {
			this.timeSinceGrounded = 0;
			this.timeSinceLanding += dt;
		}

		// Track facing from velocity (ground-plane)
		const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
		if (horizSpeed > 0.5) {
			this.facing.set(this.velocity.x, 0, this.velocity.z).normalize();
		}

		if (input.jumpPressed) this.jumpBufferT = 0;
		else this.jumpBufferT += dt;

		const coyoteSec = config.coyoteMs / 1000;
		const bufferSec = config.bufferMs / 1000;
		const wallStickSec = config.wallStickMs / 1000;
		const canGroundJump = this.timeSinceGrounded <= coyoteSec && this.jumpBufferT <= bufferSec;
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

		// Aerial action moves (ground pound / dive). Only when airborne and not mid-special.
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

		// Variable jump height (M64 style). When jump button is NOT held during ascent,
		// gravity is multiplied so the jump cuts short. Only applies to normal/double/triple.
		const cuttable =
			this.state === 'airborne' &&
			(this.jumpChain === 1 || this.jumpChain === 2 || this.jumpChain === 3);
		const cutActive = cuttable && !input.jumpHeld && this.velocity.y > 0;
		const gravMult = cutActive ? config.jumpAscentCutMult : 1;

		this.velocity.y += config.gravity * gravMult * dt;
		if (this.velocity.y < -config.terminalVel) this.velocity.y = -config.terminalVel;

		const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
		this.controller.computeColliderMovement(this.collider, desired);

		const wasGrounded = this.grounded;
		this.grounded = this.controller.computedGrounded();
		if (this.grounded) {
			if (!wasGrounded) {
				const fellFast = this.velocity.y < -15;
				// Landing: capture pre-land state for bounces
				if (this.state === 'ground_pound') {
					this.velocity.y = config.groundPoundBounce;
					haptic(60);
				} else if (this.velocity.y < 0) {
					this.velocity.y = 0;
				}
				// Dive lands: skid — reduce XZ significantly
				if (this.state === 'dive') {
					this.velocity.x *= 0.3;
					this.velocity.z *= 0.3;
				}
				if (fellFast && this.state !== 'ground_pound') haptic(25);
				this.timeSinceLanding = 0;
				this.chainOnLanding = this.jumpChain;
				this.jumpChain = 0;
				this.state = 'grounded';
			} else if (this.velocity.y < 0) {
				this.velocity.y = 0;
			}
		} else if (wasGrounded) {
			this.state = 'airborne';
		}

		// Query surface by downward raycast (also updates slope normal)
		this.surface = this.queryGroundSurface(physics);

		// Slope momentum
		this.applySlopePhysics(dt);

		// Wall detection (horizontal raycasts)
		this.timeSinceWall += dt;
		const wallHit = this.grounded ? null : this.queryWallContact(physics);
		if (wallHit) {
			this.wallNormal = wallHit;
			this.timeSinceWall = 0;
			if (this.velocity.y < 0 && this.state !== 'ground_pound') {
				this.state = 'wall_slide';
				// Dampen fall while sliding
				this.velocity.y = Math.max(this.velocity.y, -3);
			}
		}

		const corrected = this.controller.computedMovement();
		const pos = this.body.translation();
		const next = { x: pos.x + corrected.x, y: pos.y + corrected.y, z: pos.z + corrected.z };
		this.body.setNextKinematicTranslation(next);

		if (next.y < -20) this.respawn();
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
		const ny = Math.max(-1, Math.min(1, this.slopeNormal.y));
		const angleDeg = Math.acos(ny) * (180 / Math.PI);
		if (angleDeg < 5) return; // flat

		// Project gravity onto slope plane → fall direction
		const g = new THREE.Vector3(0, config.gravity, 0);
		const n = this.slopeNormal.clone().normalize();
		const gAlong = g.clone().sub(n.clone().multiplyScalar(g.dot(n)));

		if (angleDeg >= config.slopeSlideAngleDeg) {
			// Steep → full slide (player loses control, gravity-along applies)
			this.velocity.x += gAlong.x * dt;
			this.velocity.z += gAlong.z * dt;
		} else {
			// Gentle → downhill boost if moving with slope (dot > 0)
			const horizVel = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
			const horizFall = new THREE.Vector3(gAlong.x, 0, gAlong.z);
			if (horizFall.lengthSq() < 1e-4) return;
			const horizFallDir = horizFall.clone().normalize();
			const alignment = horizVel.dot(horizFallDir);
			if (alignment > 0) {
				const boost = config.slopeBoost * (angleDeg / config.slopeSlideAngleDeg) * dt;
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

		// Is input reversed vs current velocity direction? (for side flip)
		const velDirX = horizSpeed > 0.5 ? this.velocity.x / horizSpeed : 0;
		const velDirZ = horizSpeed > 0.5 ? this.velocity.z / horizSpeed : 0;
		const reversed =
			inputMag > 0.5 && horizSpeed > 0.5 && inputDirX * velDirX + inputDirZ * velDirZ < -0.5;

		const windowSec = config.doubleJumpWindowMs / 1000;
		const canChain =
			this.timeSinceLanding <= windowSec && this.chainOnLanding >= 1 && horizSpeed > 2;

		// Priority: long jump > backflip > side flip > chain jump > normal jump
		if (input.crouchHeld && horizSpeed > 3) {
			// Long jump: low arc, huge horizontal, preserves direction
			this.velocity.y = config.longJumpVelY;
			const dirX = velDirX || inputDirX;
			const dirZ = velDirZ || inputDirZ;
			this.velocity.x = dirX * config.longJumpVelXZ;
			this.velocity.z = dirZ * config.longJumpVelXZ;
			this.state = 'long_jump';
			this.jumpChain = 0; // long jump doesn't chain
		} else if (input.crouchHeld) {
			// Backflip: high vertical, small backward push from facing
			this.velocity.y = config.backflipVelY;
			this.velocity.x = -this.facing.x * Math.abs(config.backflipVelXZ);
			this.velocity.z = -this.facing.z * Math.abs(config.backflipVelXZ);
			this.state = 'backflip';
			this.jumpChain = 0;
		} else if (reversed && horizSpeed > 3) {
			// Side flip: flip input direction, medium-high vertical
			this.velocity.y = config.sideFlipVelY;
			this.velocity.x = inputDirX * config.longJumpVelXZ * 0.6;
			this.velocity.z = inputDirZ * config.longJumpVelXZ * 0.6;
			this.state = 'side_flip';
			this.jumpChain = 0;
		} else if (canChain) {
			// Double or triple jump
			this.jumpChain = this.chainOnLanding + 1;
			if (this.jumpChain >= 3) {
				this.velocity.y = config.tripleJumpVel;
				this.jumpChain = 3;
			} else {
				this.velocity.y = config.doubleJumpVel;
			}
			this.state = 'airborne';
		} else {
			// Normal jump
			this.velocity.y = config.jumpVel;
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
			slopeAngleDeg: Math.acos(Math.min(1, Math.max(-1, this.slopeNormal.y))) * (180 / Math.PI),
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
}

function approach(current: number, target: number, step: number): number {
	if (current < target) return Math.min(current + step, target);
	if (current > target) return Math.max(current - step, target);
	return current;
}

function haptic(ms: number): void {
	if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
		navigator.vibrate(ms);
	}
}
