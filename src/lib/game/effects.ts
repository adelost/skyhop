import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from './physics';

/**
 * A dark disk on the ground directly under the player. Scales + fades with
 * height above ground so airborne heights stay readable. Works even when real
 * shadow maps are off (mobile).
 */
export class BlobShadow {
	readonly mesh: THREE.Mesh;
	private readonly mat: THREE.MeshBasicMaterial;
	private readonly maxHeight: number;

	constructor(scene: THREE.Scene, radius = 0.6, maxHeight = 6) {
		const geo = new THREE.CircleGeometry(radius, 20);
		geo.rotateX(-Math.PI / 2);
		this.mat = new THREE.MeshBasicMaterial({
			color: 0x000000,
			transparent: true,
			opacity: 0.45,
			depthWrite: false
		});
		this.mesh = new THREE.Mesh(geo, this.mat);
		this.mesh.renderOrder = 1;
		scene.add(this.mesh);
		this.maxHeight = maxHeight;
	}

	update(physics: Physics, playerPos: THREE.Vector3, excludeCollider: RAPIER.Collider): void {
		const { world, rapier } = physics;
		const ray = new rapier.Ray(
			{ x: playerPos.x, y: playerPos.y, z: playerPos.z },
			{ x: 0, y: -1, z: 0 }
		);
		const hit = world.castRay(ray, 20, true, undefined, undefined, excludeCollider);
		if (!hit) {
			this.mesh.visible = false;
			return;
		}
		const heightAbove = hit.timeOfImpact;
		if (heightAbove > this.maxHeight) {
			this.mesh.visible = false;
			return;
		}
		this.mesh.visible = true;
		const groundY = playerPos.y - heightAbove + 0.02;
		this.mesh.position.set(playerPos.x, groundY, playerPos.z);
		const t = heightAbove / this.maxHeight; // 0 (on ground) → 1 (at max)
		const scale = 1 - t * 0.75; // shrink to 25% at max height
		this.mesh.scale.set(scale, 1, scale);
		this.mat.opacity = 0.45 * (1 - t);
	}

	dispose(): void {
		this.mesh.removeFromParent();
		this.mesh.geometry.dispose();
		this.mat.dispose();
	}
}

type DustParticle = {
	mesh: THREE.Mesh;
	mat: THREE.MeshBasicMaterial;
	velocity: THREE.Vector3;
	age: number;
	life: number;
	baseScale: number;
	active: boolean;
};

/**
 * Fixed-size pool of tan dust puffs. emit() reuses the oldest inactive slot;
 * update() fades + moves each active particle. No allocations per frame.
 */
export class DustPool {
	private readonly particles: DustParticle[] = [];
	private readonly geo: THREE.SphereGeometry;

	constructor(scene: THREE.Scene, size = 24) {
		this.geo = new THREE.SphereGeometry(0.12, 6, 4);
		for (let i = 0; i < size; i++) {
			const mat = new THREE.MeshBasicMaterial({
				color: 0xd4c29a,
				transparent: true,
				opacity: 0,
				depthWrite: false
			});
			const mesh = new THREE.Mesh(this.geo, mat);
			mesh.visible = false;
			scene.add(mesh);
			this.particles.push({
				mesh,
				mat,
				velocity: new THREE.Vector3(),
				age: 0,
				life: 0,
				baseScale: 1,
				active: false
			});
		}
	}

	/**
	 * Spawn `count` puffs around `pos`. `upward` = vertical velocity scalar,
	 * `outward` = radial XZ velocity scalar. Reasonable: 2/1.5 for light landing,
	 * 3/3 for pound impact, 1/2 for skid (emphasize outward).
	 */
	emit(pos: THREE.Vector3, count: number, upward = 2, outward = 1.5): void {
		for (let i = 0; i < count; i++) {
			const p = this.findInactive();
			if (!p) return;
			p.active = true;
			p.age = 0;
			p.life = 0.3 + Math.random() * 0.25;
			const angle = Math.random() * Math.PI * 2;
			const mag = outward * (0.5 + Math.random() * 0.6);
			p.velocity.set(
				Math.cos(angle) * mag,
				upward * (0.4 + Math.random() * 0.6),
				Math.sin(angle) * mag
			);
			p.mesh.position.copy(pos);
			p.mesh.position.y += 0.05;
			p.mesh.visible = true;
			p.mat.opacity = 0.65;
			p.baseScale = 0.6 + Math.random() * 0.5;
			p.mesh.scale.setScalar(p.baseScale);
		}
	}

	update(dt: number): void {
		for (const p of this.particles) {
			if (!p.active) continue;
			p.age += dt;
			const lifeFrac = p.age / p.life;
			if (lifeFrac >= 1) {
				p.active = false;
				p.mesh.visible = false;
				continue;
			}
			p.mesh.position.addScaledVector(p.velocity, dt);
			p.velocity.y -= 4 * dt; // slight gravity
			p.velocity.multiplyScalar(0.94); // drag
			p.mat.opacity = 0.65 * (1 - lifeFrac);
			p.mesh.scale.setScalar(p.baseScale * (1 + lifeFrac * 0.4)); // puff grows slightly
		}
	}

	private findInactive(): DustParticle | undefined {
		for (const p of this.particles) {
			if (!p.active) return p;
		}
		return undefined;
	}

	dispose(): void {
		for (const p of this.particles) {
			p.mesh.removeFromParent();
			p.mat.dispose();
		}
		this.geo.dispose();
	}
}
