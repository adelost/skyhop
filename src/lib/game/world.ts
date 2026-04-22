import * as THREE from 'three';
import type { Physics } from './physics';

export type Surface = 'grass' | 'ice' | 'stone' | 'moving';

export type Obstacle = {
	pos: [number, number, number];
	size: [number, number, number];
	color: number;
	rotation?: [number, number, number];
	surface?: Surface;
	label?: string;
};

export const ARENA: Obstacle[] = [
	// Main ground
	{ pos: [0, -0.5, 0], size: [30, 1, 30], color: 0x4a7c59, label: 'ground' },

	// Slopes at 15°, 30°, 45°, 60° — going away from center north
	{ pos: [-10, 0.5, -6], size: [3, 0.5, 6], color: 0x558c69, rotation: [(15 * Math.PI) / 180, 0, 0], label: 'slope15' },
	{ pos: [-3, 1, -6], size: [3, 0.5, 6], color: 0x6b9c79, rotation: [(30 * Math.PI) / 180, 0, 0], label: 'slope30' },
	{ pos: [4, 1.7, -6], size: [3, 0.5, 6], color: 0x86ac89, rotation: [(45 * Math.PI) / 180, 0, 0], label: 'slope45' },
	{ pos: [11, 2.4, -6], size: [3, 0.5, 6], color: 0xa0bc99, rotation: [(60 * Math.PI) / 180, 0, 0], label: 'slope60' },

	// Wall för wall-kick (Steg 4)
	{ pos: [-12, 2, 4], size: [0.5, 5, 8], color: 0x7a5030, label: 'wall' },

	// Gap-test plattformar (hopp 3m, 5m, 7m)
	{ pos: [0, 0.25, 10], size: [3, 0.5, 3], color: 0xc06c30, label: 'gap-src' },
	{ pos: [0, 0.25, 14], size: [3, 0.5, 3], color: 0xc06c30, label: 'gap-3m' },
	{ pos: [0, 0.25, 19.5], size: [3, 0.5, 3], color: 0xe08030, label: 'gap-5m' },
	{ pos: [0, 0.25, 26], size: [3, 0.5, 3], color: 0xe04030, label: 'gap-7m' },

	// Hög plattform — testa fall
	{ pos: [10, 5, 8], size: [4, 0.5, 4], color: 0xf0c040, label: 'high' },
	{ pos: [7, 2.5, 8], size: [3, 0.5, 3], color: 0xc06c30, label: 'mid' },
	{ pos: [4, 1, 8], size: [3, 0.5, 3], color: 0xc06c30, label: 'low' },

	// Lågt tak (bump head)
	{ pos: [-8, 2.5, 8], size: [4, 0.3, 4], color: 0x6040a0, label: 'ceiling' },

	// Ice-patch
	{ pos: [8, 0.25, -2], size: [5, 0.5, 5], color: 0xa0e0f0, surface: 'ice', label: 'ice' }
];

export type MovingPlatform = {
	mesh: THREE.Mesh;
	bodyHandle: number;
	base: THREE.Vector3;
	amp: number;
	axis: 'x' | 'y' | 'z';
	speed: number;
};

export function buildWorld(
	scene: THREE.Scene,
	physics: Physics
): { moving: MovingPlatform[] } {
	const { world, rapier } = physics;
	const moving: MovingPlatform[] = [];

	for (const o of ARENA) {
		const geo = new THREE.BoxGeometry(...o.size);
		const mat = new THREE.MeshStandardMaterial({
			color: o.color,
			roughness: o.surface === 'ice' ? 0.2 : 0.9,
			metalness: 0
		});
		const mesh = new THREE.Mesh(geo, mat);
		mesh.position.set(...o.pos);
		if (o.rotation) mesh.rotation.set(...o.rotation);
		scene.add(mesh);

		const bodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(...o.pos);
		if (o.rotation) {
			const q = new THREE.Quaternion().setFromEuler(
				new THREE.Euler(o.rotation[0], o.rotation[1], o.rotation[2])
			);
			bodyDesc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
		}
		const body = world.createRigidBody(bodyDesc);
		const colDesc = rapier.ColliderDesc.cuboid(o.size[0] / 2, o.size[1] / 2, o.size[2] / 2);
		if (o.surface === 'ice') colDesc.setFriction(0.02);
		else colDesc.setFriction(1.0);
		world.createCollider(colDesc, body);
	}

	// Moving platform (kinematic Y-bounce)
	{
		const pos: [number, number, number] = [-6, 2, 14];
		const size: [number, number, number] = [4, 0.5, 4];
		const geo = new THREE.BoxGeometry(...size);
		const mat = new THREE.MeshStandardMaterial({ color: 0xd040a0, roughness: 0.8 });
		const mesh = new THREE.Mesh(geo, mat);
		mesh.position.set(...pos);
		scene.add(mesh);

		const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(...pos);
		const body = world.createRigidBody(bodyDesc);
		const colDesc = rapier.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2);
		world.createCollider(colDesc, body);

		moving.push({
			mesh,
			bodyHandle: body.handle,
			base: new THREE.Vector3(...pos),
			amp: 3,
			axis: 'y',
			speed: 0.8
		});
	}

	return { moving };
}

export function updateMovingPlatforms(
	movings: MovingPlatform[],
	physics: Physics,
	t: number
): void {
	for (const m of movings) {
		const offset = Math.sin(t * m.speed) * m.amp;
		const target = m.base.clone();
		if (m.axis === 'x') target.x += offset;
		else if (m.axis === 'y') target.y += offset;
		else target.z += offset;

		const body = physics.world.getRigidBody(m.bodyHandle);
		if (body) body.setNextKinematicTranslation({ x: target.x, y: target.y, z: target.z });
		m.mesh.position.copy(target);
	}
}
