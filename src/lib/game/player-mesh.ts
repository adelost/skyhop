import * as THREE from 'three';

const RADIUS = 0.4;
const HEIGHT = 0.8;
const EYE_HEIGHT = 0.3;

export type PlayerMeshes = {
	outer: THREE.Group; // physics-aligned (position only)
	inner: THREE.Group; // rotation + scale + pivot offset
	body: THREE.Mesh;
	nose: THREE.Mesh;
};

/**
 * Build the nested mesh tree. Outer group follows physics; inner group handles
 * all visual transforms. Nose + eyes point in the −Z local direction.
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

	return { outer, inner, body, nose };
}
