import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from './physics';
import type { InputState } from './input';

const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.12;
const JUMP_VELOCITY = 10;
const JUMP_CUT = 0.45;
const MOVE_SPEED = 6;
const ACCEL = 50;
const DECEL = 40;
const GRAVITY = -30;
const RADIUS = 0.4;
const HEIGHT = 0.8;

export class Player {
	readonly mesh: THREE.Mesh;
	private body: RAPIER.RigidBody;
	private controller: RAPIER.KinematicCharacterController;
	private collider: RAPIER.Collider;

	private velocity = new THREE.Vector3();
	private grounded = false;
	private timeSinceGrounded = 999;
	private jumpBufferT = 999;
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
	}

	step(dt: number, input: InputState, physics: Physics): void {
		const targetX = input.moveX * MOVE_SPEED;
		const targetZ = input.moveZ * MOVE_SPEED;

		const accel = Math.abs(input.moveX) > 0.01 ? ACCEL : DECEL;
		this.velocity.x = approach(this.velocity.x, targetX, accel * dt);
		const accelZ = Math.abs(input.moveZ) > 0.01 ? ACCEL : DECEL;
		this.velocity.z = approach(this.velocity.z, targetZ, accelZ * dt);

		this.timeSinceGrounded += dt;
		if (this.grounded) this.timeSinceGrounded = 0;

		if (input.jumpPressed) this.jumpBufferT = 0;
		else this.jumpBufferT += dt;

		const canJump = this.timeSinceGrounded <= COYOTE_TIME && this.jumpBufferT <= JUMP_BUFFER;
		if (canJump) {
			this.velocity.y = JUMP_VELOCITY;
			this.timeSinceGrounded = 999;
			this.jumpBufferT = 999;
			this.grounded = false;
		}

		if (!input.jumpHeld && this.velocity.y > 0) {
			this.velocity.y *= JUMP_CUT;
		}

		this.velocity.y += GRAVITY * dt;
		if (this.velocity.y < -40) this.velocity.y = -40;

		const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
		this.controller.computeColliderMovement(this.collider, desired);
		this.grounded = this.controller.computedGrounded();
		if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;

		const corrected = this.controller.computedMovement();
		const pos = this.body.translation();
		const next = { x: pos.x + corrected.x, y: pos.y + corrected.y, z: pos.z + corrected.z };
		this.body.setNextKinematicTranslation(next);

		if (next.y < -20) this.respawn();
	}

	sync(): void {
		const t = this.body.translation();
		this.mesh.position.set(t.x, t.y, t.z);
	}

	get position(): THREE.Vector3 {
		return this.mesh.position;
	}
}

function approach(current: number, target: number, step: number): number {
	if (current < target) return Math.min(current + step, target);
	if (current > target) return Math.max(current - step, target);
	return current;
}
