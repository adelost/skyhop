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
	private state: PlayerState = 'airborne';
	private surface = 'air';
	private slopeNormal = new THREE.Vector3(0, 1, 0);
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
		const speedTarget = config.moveSpeed;
		const targetX = input.moveX * speedTarget;
		const targetZ = input.moveZ * speedTarget;

		// Ground accel/decel vs air control. Ice = tiny decel (slippery).
		const hasInput = Math.abs(input.moveX) > 0.01 || Math.abs(input.moveZ) > 0.01;
		const onIce = this.surface === 'ice';
		let groundRate: number;
		if (hasInput) groundRate = onIce ? config.accel * config.iceFriction : config.accel;
		else groundRate = onIce ? config.decel * config.iceFriction : config.decel;
		const accelRate = this.grounded ? groundRate : config.accel * config.airControl;

		this.velocity.x = approach(this.velocity.x, targetX, accelRate * dt);
		this.velocity.z = approach(this.velocity.z, targetZ, accelRate * dt);

		this.timeSinceGrounded += dt;
		if (this.grounded) {
			this.timeSinceGrounded = 0;
			this.timeSinceLanding += dt;
		}

		if (input.jumpPressed) this.jumpBufferT = 0;
		else this.jumpBufferT += dt;

		const coyoteSec = config.coyoteMs / 1000;
		const bufferSec = config.bufferMs / 1000;
		const canJump = this.timeSinceGrounded <= coyoteSec && this.jumpBufferT <= bufferSec;

		if (canJump) {
			this.velocity.y = config.jumpVel;
			this.timeSinceGrounded = 999;
			this.jumpBufferT = 999;
			this.grounded = false;
			this.state = 'airborne';
			this.jumpChain = 1;
			this.timeSinceLanding = 999;
		}

		// Variable jump height (release early = cut)
		if (!input.jumpHeld && this.velocity.y > 0) {
			this.velocity.y *= config.jumpCut;
		}

		this.velocity.y += config.gravity * dt;
		if (this.velocity.y < -config.terminalVel) this.velocity.y = -config.terminalVel;

		const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
		this.controller.computeColliderMovement(this.collider, desired);

		const wasGrounded = this.grounded;
		this.grounded = this.controller.computedGrounded();
		if (this.grounded) {
			if (this.velocity.y < 0) this.velocity.y = 0;
			if (!wasGrounded) {
				this.timeSinceLanding = 0;
				this.jumpChain = 0;
				this.state = 'grounded';
			}
		} else if (wasGrounded) {
			this.state = 'airborne';
		}

		// Query surface by downward raycast (also updates slope normal)
		this.surface = this.queryGroundSurface(physics);

		// Slope momentum
		this.applySlopePhysics(dt);

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
}

function approach(current: number, target: number, step: number): number {
	if (current < target) return Math.min(current + step, target);
	if (current > target) return Math.max(current - step, target);
	return current;
}
