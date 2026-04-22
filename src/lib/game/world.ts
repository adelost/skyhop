import * as THREE from 'three';
import type { Physics } from './physics';

export type Platform = {
	x: number;
	y: number;
	z: number;
	width: number;
	height: number;
	depth: number;
	color: number;
};

export const LEVEL_1: Platform[] = [
	{ x: 0, y: -0.5, z: 0, width: 20, height: 1, depth: 20, color: 0x4a7c59 },
	{ x: 4, y: 1, z: -2, width: 3, height: 0.5, depth: 3, color: 0xc06c30 },
	{ x: 7, y: 2.5, z: -5, width: 3, height: 0.5, depth: 3, color: 0xc06c30 },
	{ x: 3, y: 4, z: -8, width: 3, height: 0.5, depth: 3, color: 0xc06c30 },
	{ x: -2, y: 5.5, z: -6, width: 3, height: 0.5, depth: 3, color: 0xf0c040 },
	{ x: -6, y: 1.5, z: 2, width: 4, height: 0.5, depth: 4, color: 0xc06c30 }
];

export function buildWorld(scene: THREE.Scene, physics: Physics): void {
	const { world, rapier } = physics;

	const platformMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });

	for (const p of LEVEL_1) {
		const geo = new THREE.BoxGeometry(p.width, p.height, p.depth);
		const mat = platformMat.clone();
		mat.color.setHex(p.color);
		const mesh = new THREE.Mesh(geo, mat);
		mesh.position.set(p.x, p.y, p.z);
		scene.add(mesh);

		const bodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z);
		const body = world.createRigidBody(bodyDesc);
		const colliderDesc = rapier.ColliderDesc.cuboid(p.width / 2, p.height / 2, p.depth / 2);
		world.createCollider(colliderDesc, body);
	}
}
