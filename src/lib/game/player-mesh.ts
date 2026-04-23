import * as THREE from 'three';
import { RADIUS, HEIGHT } from './player-constants';

const EYE_HEIGHT = 0.3;

export type Limbs = {
	armL: THREE.Mesh;
	armR: THREE.Mesh;
	footL: THREE.Mesh;
	footR: THREE.Mesh;
};

export type PlayerMeshes = {
	outer: THREE.Group; // physics-aligned (position only)
	inner: THREE.Group; // rotation + scale + pivot offset
	limbs: Limbs;
};

/**
 * Build the nested mesh tree. Outer group follows physics; inner group handles
 * all visual transforms (rotation, scale, pivot). Limbs are children of inner
 * so they inherit flips + scales, but their local positions are state-driven
 * in computePose for procedural posing (no rig, no animations).
 */
export function buildPlayerMeshes(): PlayerMeshes {
	const outer = new THREE.Group();
	const inner = new THREE.Group();
	outer.add(inner);

	const bodyGeo = new THREE.CapsuleGeometry(RADIUS, HEIGHT, 4, 8);
	const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe03030, roughness: 0.4 });
	const body = new THREE.Mesh(bodyGeo, bodyMat);
	inner.add(body);

	const noseGeo = new THREE.ConeGeometry(0.18, 0.4, 10);
	noseGeo.rotateX(-Math.PI / 2);
	const noseMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
	const nose = new THREE.Mesh(noseGeo, noseMat);
	nose.position.set(0, EYE_HEIGHT, -RADIUS - 0.1);
	inner.add(nose);

	const eyeGeo = new THREE.SphereGeometry(0.06, 8, 6);
	const eyeMat = new THREE.MeshStandardMaterial({ color: 0x221818, roughness: 0.2 });
	const eL = new THREE.Mesh(eyeGeo, eyeMat);
	eL.position.set(-0.13, EYE_HEIGHT + 0.1, -RADIUS - 0.05);
	const eR = new THREE.Mesh(eyeGeo, eyeMat);
	eR.position.set(0.13, EYE_HEIGHT + 0.1, -RADIUS - 0.05);
	inner.add(eL);
	inner.add(eR);

	// Mittens: rigid round hands. No rig — positions animated procedurally per state.
	const armGeo = new THREE.SphereGeometry(0.11, 10, 8);
	const armMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
	const armL = new THREE.Mesh(armGeo, armMat);
	const armR = new THREE.Mesh(armGeo, armMat);
	// Default "arms at sides" local positions (overridden by computeLimbs).
	armL.position.set(-RADIUS - 0.08, 0.1, 0);
	armR.position.set(RADIUS + 0.08, 0.1, 0);
	inner.add(armL);
	inner.add(armR);

	// Foot-nubs: small flattened boxes = shoe silhouettes.
	const footGeo = new THREE.BoxGeometry(0.16, 0.08, 0.22);
	const footMat = new THREE.MeshStandardMaterial({ color: 0x2a1b12, roughness: 0.5 });
	const footL = new THREE.Mesh(footGeo, footMat);
	const footR = new THREE.Mesh(footGeo, footMat);
	const footBaseY = -(HEIGHT / 2 + RADIUS) + 0.04;
	footL.position.set(-0.15, footBaseY, 0);
	footR.position.set(0.15, footBaseY, 0);
	inner.add(footL);
	inner.add(footR);

	return { outer, inner, limbs: { armL, armR, footL, footR } };
}
